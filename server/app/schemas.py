from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Login(StrictModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


class MemoryData(StrictModel):
    displayName: str = Field(default="", max_length=80)
    about: str = Field(default="", max_length=1000)
    preferences: str = Field(default="", max_length=1500)
    availability: str = Field(default="", max_length=1000)
