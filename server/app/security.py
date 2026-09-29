import hashlib
import hmac
import secrets
import time
from collections import OrderedDict, deque
from threading import Lock

from fastapi import HTTPException


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
    return f"scrypt${salt}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    _, salt, expected = encoded.split("$")
    actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
    return hmac.compare_digest(actual.hex(), expected)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class RateLimiter:
    """Bounded in-process limiter. Production runs exactly one API worker."""

    def __init__(self):
        self.entries = OrderedDict()
        self.lock = Lock()

    def check(self, key: str, limit: int, window: int = 60):
        now = time.monotonic()
        with self.lock:
            bucket = self.entries.setdefault(key, deque())
            self.entries.move_to_end(key)
            while bucket and bucket[0] < now - window:
                bucket.popleft()
            if len(bucket) >= limit:
                raise HTTPException(429, "Слишком много запросов. Попробуйте через минуту.")
            bucket.append(now)
            while len(self.entries) > 2048:
                self.entries.popitem(last=False)
