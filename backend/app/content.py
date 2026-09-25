"""Validated editable content shared by generation, review and export."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field

Text = Annotated[str, Field(min_length=1, max_length=2000)]

class Section(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=160)
    body: list[Text] = Field(min_length=1, max_length=12)
    notes: str = Field(default='', max_length=3000)

class Content(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=180)
    summary: str = Field(default='', max_length=600)
    language: Literal['ar', 'en'] = 'ar'
    sections: list[Section] = Field(min_length=1, max_length=20)

class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    topic: str = Field(min_length=5, max_length=3000)
    audience: str = Field(default='فريق العمل', max_length=200)
    language: Literal['ar', 'en'] = 'ar'
    tone: Literal['formal', 'educational', 'concise'] = 'formal'
    format: Literal['docx', 'pptx'] = 'pptx'
    section_count: int = Field(default=6, ge=2, le=12)
    phase: Literal['outline', 'draft'] = 'outline'
    outline: list[Annotated[str, Field(min_length=1, max_length=160)]] = Field(default_factory=list, max_length=12)
    approved_title: str = Field(default='', max_length=180)
    reference_text: str = Field(default='', max_length=16000)
    source_mode: Literal['general', 'reference'] = 'general'

class ReviseRequest(BaseModel):
    content: Content
    instruction: str = Field(min_length=5, max_length=2000)
    reference_text: str = Field(default='', max_length=16000)
    source_mode: Literal['general', 'reference'] = 'general'
