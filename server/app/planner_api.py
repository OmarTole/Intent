import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .db import Event, User, get_db
from .commands import simple_proposal
from .planner import PlannerData, PlannerState, PlannerUpdate, ScheduleProposal, ScheduleRequest, ScheduleGeneration, TrainingGeneration, training_to_proposal, enforce_reminder_request


def register_planner(app, current_user, interpreter, memory_for, limiter):
    @app.get("/api/planner")
    def get_planner(user: User = Depends(current_user), db: Session = Depends(get_db)):
        row = db.get(PlannerState, user.id)
        return {**(row.data if row else PlannerData().model_dump(mode="json")), "version": row.version if row else 0}

    @app.put("/api/planner")
    def save_planner(body: PlannerUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
        data = body.model_dump(mode="json", exclude={"version"})
        row = db.get(PlannerState, user.id)
        if row:
            result = db.execute(update(PlannerState).where(PlannerState.user_id == user.id, PlannerState.version == body.version).values(data=data, version=body.version + 1))
            if result.rowcount != 1:
                db.rollback()
                raise HTTPException(409, "Расписание изменилось в другой вкладке. Обновите данные и повторите изменение.")
        elif body.version == 0:
            db.add(PlannerState(user_id=user.id, data=data, version=1))
        else:
            raise HTTPException(409, "Обновите расписание.")
        db.add(Event(user_id=user.id, intent_id="planner", message="Обновлено расписание или отметки дня"))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Расписание уже изменено. Обновите данные.")
        return {**data, "version": body.version + 1}

    @app.post("/api/planner/propose")
    async def propose(body: ScheduleRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
        limiter.check("ai:" + user.id, 6)
        try:
            zone = ZoneInfo(body.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise HTTPException(422, "Неизвестный часовой пояс")
        simple = simple_proposal(body.text, datetime.now(zone))
        if simple is not None:
            return simple
        row = db.get(PlannerState, user.id)
        existing = [{k: v for k, v in a.items() if k not in {'program', 'id'}} for a in (row.data.get("activities", []) if row else []) if not a.get('archived')][:40]
        instruction = (
            "Ты персональный планировщик. Отвечай по-русски. Предлагай ГОТОВЫЕ события и программы, "
            "Не повторяй исходное сообщение пользователя: сразу дай уточнение или короткий итог предложения. "
            "а не задачи 'составить расписание', 'выбрать упражнения'. Ничего не сохраняй сам. "
            "Если не указан год, используй ближайшую будущую дату и явно назови её в message. "
            "Если для напоминания не хватает времени или срока предупреждения, задай уточняющий вопрос "
            "(clarification=true, activities=[]). Не выдумывай важные сведения. "
            "Для weekly weekdays: понедельник=0, воскресенье=6. День рождения — yearly, разовое мероприятие — once. "
            "reminder — минуты ДО начала, null — отключено. Даты YYYY-MM-DD, время HH:MM. "
            "Не изменяй существующие записи. Учитывай занятые часы, при конфликте предложи альтернативу. "
            f"Сейчас {datetime.now(zone).isoformat()}, пояс {body.timezone}. "
            f"Память: {memory_for(user.id, db).model_dump_json()}. "
            f"Расписание: {json.dumps(existing, ensure_ascii=False)}"
        )
        schema = TrainingGeneration if re.search(r"трениров|силов|плаван", body.text, re.I) else ScheduleGeneration
        if schema is TrainingGeneration:
            instruction += (
                " Для тренировок уточни подготовку, ограничения и оборудование, если неизвестны. "
                "Дай одну повторяющуюся тренировку с нужными weekdays, если разные программы не запрошены. "
                "blocks содержит 4–6 блоков: подготовка, разминка, силовые, плавание, восстановление. "
                "Сумма minutes равна duration. details: общепринятые названия упражнений, подходы, повторы, паузы. "
                "Не назначай конкретный вес без оценки возможностей. Для плавания указывай дистанции в метрах, "
                "спокойный темп и отдых. Не выдумывай стили и названия. В program верни пустую строку: текст будет составлен из blocks."
            )
        else:
            instruction += " program — только известные детали события, без придуманных занятий и советов. Можно пустую строку."
        generated = await interpreter._generate(schema, instruction, [{"role": "user", "content": body.text}], 3000)
        result = training_to_proposal(generated) if isinstance(generated, TrainingGeneration) else ScheduleProposal.model_validate(generated.root.model_dump())
        return enforce_reminder_request(result, body.text)
