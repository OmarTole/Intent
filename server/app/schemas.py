from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Kind = Literal["personalGoal", "reminder", "meeting", "activity", "project", "general"]
Status = Literal["active", "paused", "completed", "cancelled"]
ShortText = Annotated[str, Field(min_length=1, max_length=200)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Login(StrictModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


class Interpretation(StrictModel):
    text: str = Field(min_length=3, max_length=2000)


class MemoryData(StrictModel):
    displayName: str = Field(default="", max_length=80)
    about: str = Field(default="", max_length=1000)
    preferences: str = Field(default="", max_length=1500)
    availability: str = Field(default="", max_length=1000)


class AgentResponse(StrictModel):
    mode: Literal["clarification", "draft"]
    message: str = Field(min_length=1, max_length=600)
    title: str | None = Field(default=None, max_length=120)
    summary: str | None = Field(default=None, max_length=1000)
    kind: Kind | None = None
    steps: list[ShortText] = Field(default_factory=list, max_length=6)

    @model_validator(mode="after")
    def complete_draft(self):
        if self.mode == "draft" and (not self.title or not self.summary or not self.kind or not self.steps):
            raise ValueError("Готовый план должен содержать название, описание, тип и шаги")
        if self.mode == "clarification" and (self.title or self.summary or self.kind or self.steps):
            raise ValueError("Уточнение не должно содержать черновик")
        return self


class AgentDraftResponse(StrictModel):
    mode: Literal["draft"]
    message: str = Field(min_length=1, max_length=600)
    title: str = Field(min_length=1, max_length=120)
    summary: str = Field(min_length=1, max_length=1000)
    kind: Kind
    steps: list[ShortText] = Field(min_length=1, max_length=6)


class AgentTurnRequest(StrictModel):
    text: str = Field(min_length=1, max_length=2000)


class CoachRequest(StrictModel):
    note: str = Field(default="", max_length=1000)


class CoachResponse(StrictModel):
    message: str = Field(min_length=1, max_length=800)
    nextStep: str = Field(min_length=1, max_length=200)
    encouragement: str = Field(default="", max_length=300)


class Draft(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    summary: str = Field(min_length=1, max_length=1000)
    kind: Kind
    steps: list[ShortText] = Field(min_length=1, max_length=6)


class Step(StrictModel):
    id: UUID
    title: ShortText
    isCompleted: bool = False


class IntentData(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    rawText: str = Field(max_length=2000)
    summary: str = Field(max_length=1000)
    kind: Kind = "general"
    status: Status = "active"
    steps: list[Step] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def unique_steps(self):
        if len({step.id for step in self.steps}) != len(self.steps):
            raise ValueError("Шаги должны иметь разные идентификаторы")
        return self


class CreateIntent(IntentData):
    id: UUID


class UpdateIntent(IntentData):
    version: int = Field(ge=1)
