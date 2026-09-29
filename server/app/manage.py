"""Run: python -m app.manage create-user alice (password prompted, never in argv)."""
import argparse
import getpass
import re

from sqlalchemy import select

from .db import Base, SessionLocal, User, engine
from .security import hash_password
from .accounts import AccountProfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["create-user", "make-admin"])
    parser.add_argument("username")
    args = parser.parse_args()
    username = args.username.strip().lower()
    if args.command == 'make-admin':
        Base.metadata.create_all(engine)
        with SessionLocal() as db:
            user = db.scalar(select(User).where(User.username == username))
            if not user:
                parser.error('Пользователь не найден')
            profile = db.get(AccountProfile, user.id)
            if not profile:
                profile = AccountProfile(user_id=user.id)
                db.add(profile)
            profile.admin = True
            db.commit()
        print('Права администратора назначены.')
        return
    if not re.fullmatch(r"[a-z0-9_@.+-]{3,80}", username):
        parser.error("Логин: 3–80 латинских букв, цифр или символов _ . -")
    password = getpass.getpass("Пароль (12–256 символов): ")
    if not 12 <= len(password) <= 256 or password != password.strip():
        parser.error("Пароль: 12–256 символов, без пробелов в начале и конце")
    if password != getpass.getpass("Повторите пароль: "):
        parser.error("Пароли не совпадают")
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.username == username)):
            parser.error("Пользователь уже существует")
        db.add(User(username=username, password_hash=hash_password(password)))
        db.commit()
    print(f"Создан пользователь {username}")


if __name__ == "__main__":
    main()
