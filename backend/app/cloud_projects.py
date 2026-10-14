"""Account-isolated MAGHRABI Office Studio cloud projects on Railway PostgreSQL.

Browser tokens are HttpOnly cookies, server-side SHA-256 hashes, SameSite Strict.
All changes require a non-simple request header; all project queries scope by
authenticated account ID. Local-only workflows remain available without DB.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import uuid
from typing import Literal

from argon2 import PasswordHasher, exceptions as argon_exceptions
from fastapi import APIRouter, HTTPException, Request, Response, Header
from pydantic import BaseModel, Field, model_validator, ConfigDict
from psycopg import connect, errors
from psycopg.rows import dict_row

from .content import Content

router = APIRouter(prefix="/api/v1")
COOKIE_NAME = "maghrabi_cloud_session"
HEADER_NAME = "X-Maghrabi-Client"
SESSION_DAYS = 14
MAX_PROJECTS = 50
MAX_PROJECT_JSON = 220_000
_hasher = PasswordHasher(time_cost=2, memory_cost=19_456, parallelism=2)
_schema_lock = threading.Lock()
_schema_ready = False
_EMAIL = re.compile(r"^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$")


def _now():
    return datetime.now(timezone.utc)


def _hash_token(token: str):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _connection():
    global _schema_ready
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        raise HTTPException(503, "الحفظ السحابي غير مهيأ. تأكد من DATABASE_URL.")
    try:
        db = connect(url, row_factory=dict_row, connect_timeout=5)
        if not _schema_ready:
            with _schema_lock:
                if not _schema_ready:
                    with db.cursor() as cur:
                        cur.execute("""
                            CREATE TABLE IF NOT EXISTS studio_accounts (
                                id UUID PRIMARY KEY,
                                email TEXT NOT NULL UNIQUE,
                                password_hash TEXT NOT NULL,
                                role TEXT NOT NULL CHECK(role IN ('owner', 'member')),
                                failed_logins INTEGER NOT NULL DEFAULT 0,
                                locked_until TIMESTAMPTZ,
                                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                            )
                        """)
                        cur.execute("""
                            CREATE TABLE IF NOT EXISTS studio_sessions (
                                token_hash TEXT PRIMARY KEY,
                                user_id UUID NOT NULL REFERENCES studio_accounts(id) ON DELETE CASCADE,
                                expires_at TIMESTAMPTZ NOT NULL,
                                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                            )
                        """)
                        cur.execute("CREATE INDEX IF NOT EXISTS studio_sessions_user ON studio_sessions(user_id)")
                        cur.execute("""
                            CREATE TABLE IF NOT EXISTS studio_invites (
                                token_hash TEXT PRIMARY KEY,
                                created_by UUID NOT NULL REFERENCES studio_accounts(id) ON DELETE CASCADE,
                                expires_at TIMESTAMPTZ NOT NULL,
                                used_at TIMESTAMPTZ
                            )
                        """)
                        cur.execute("""
                            CREATE TABLE IF NOT EXISTS studio_cloud_projects (
                                id UUID NOT NULL,
                                owner_id UUID NOT NULL REFERENCES studio_accounts(id) ON DELETE CASCADE,
                                data JSONB NOT NULL,
                                version INTEGER NOT NULL DEFAULT 1,
                                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                                PRIMARY KEY (id, owner_id)
                            )
                        """)
                        cur.execute("CREATE INDEX IF NOT EXISTS studio_cloud_projects_owner ON studio_cloud_projects(owner_id,updated_at DESC)")
                    db.commit()
                    _schema_ready = True
        return db
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "قاعدة بيانات المشاريع غير متاحة مؤقتًا.") from exc


def _require_origin(request: Request):
    if request.headers.get(HEADER_NAME) != "studio":
        raise HTTPException(403, "طلب غير مصرح به.")
    origin = request.headers.get("origin")
    if origin:
        expected_scheme = "https" if os.getenv("RAILWAY_ENVIRONMENT") else request.url.scheme
        host = request.headers.get("host", "")
        if origin != f"{expected_scheme}://{host}":
            raise HTTPException(403, "مصدر الطلب غير مسموح.")


def _valid_email(raw: str):
    email = raw.strip().lower()
    if not _EMAIL.fullmatch(email) or len(email) > 254:
        raise HTTPException(422, "أدخل بريدًا إلكترونيًا صالحًا.")
    return email


def _valid_password(password: str):
    if len(password) < 12 or len(password) > 128:
        raise HTTPException(422, "كلمة المرور يجب أن تتكون من 12 إلى 128 حرفًا.")
    if password.isspace():
        raise HTTPException(422, "كلمة المرور غير صالحة.")


class Credentials(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)


class Bootstrap(Credentials):
    setup_token: str = Field(min_length=1, max_length=512)


class Register(Credentials):
    invitation: str = Field(min_length=16, max_length=512)


class ProjectData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    date: datetime
    updatedAt: datetime | None = None
    content: Content
    format: Literal["docx", "pptx"] = "pptx"
    stage: Literal["outline", "edit"] = "edit"
    context: dict = Field(default_factory=dict)
    version: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def limit_context(self):
        if len(json.dumps(self.context, ensure_ascii=False)) > 20_000:
            raise ValueError("حجم إعدادات المشروع كبير جدًا.")
        return self


def _authorized_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE_NAME)
    if not token or len(token) > 256:
        raise HTTPException(401, "سجل الدخول إلى حسابك لعرض المشاريع السحابية.")
    with _connection() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT a.id,a.email,a.role FROM studio_sessions s
                JOIN studio_accounts a ON s.user_id=a.id
                WHERE s.token_hash=%s AND s.expires_at>now()
            """, (_hash_token(token),))
            user = cur.fetchone()
    if not user:
        raise HTTPException(401, "انتهت جلسة حسابك. سجل الدخول مجددًا.")
    return user


def _cookie_options(request: Request):
    return dict(path="/api/v1", secure=(request.url.scheme == "https" or bool(os.getenv("RAILWAY_ENVIRONMENT"))),
                httponly=True, samesite="strict")


def _start_session(db, request: Request, response: Response, user_id):
    token = secrets.token_urlsafe(48)
    with db.cursor() as cur:
        cur.execute("DELETE FROM studio_sessions WHERE expires_at < now()")
        cur.execute("INSERT INTO studio_sessions (token_hash,user_id,expires_at) VALUES (%s,%s,%s)",
                    (_hash_token(token), user_id, _now() + timedelta(days=SESSION_DAYS)))
    response.set_cookie(COOKIE_NAME, token, max_age=SESSION_DAYS*86400, **_cookie_options(request))
    response.headers["Cache-Control"] = "no-store"


@router.get("/account/status")
def account_status(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    if not os.getenv("DATABASE_URL"):
        return {"available": False, "authenticated": False, "setup_required": False}
    with _connection() as db:
        with db.cursor() as cur:
            cur.execute("SELECT EXISTS(SELECT 1 FROM studio_accounts) AS present")
            present = cur.fetchone()["present"]
    try:
        user = _authorized_user(request)
        return {"available": True, "authenticated": True, "setup_required": False,
                "email": user["email"], "role": user["role"]}
    except HTTPException as exc:
        if exc.status_code != 401:
            raise
    return {"available": True, "authenticated": False, "setup_required": not present}


@router.post("/account/bootstrap")
def bootstrap_account(payload: Bootstrap, request: Request, response: Response):
    _require_origin(request)
    email = _valid_email(payload.email)
    _valid_password(payload.password)
    secret = os.getenv("STUDIO_ACCESS_TOKEN", "")
    if not secret or not hmac.compare_digest(secret, payload.setup_token):
        raise HTTPException(403, "رمز تهيئة المدير غير صحيح.")
    with _connection() as db:
        with db.cursor() as cur:
            # Serialize concurrent owner bootstrap attempts across replicas.
            cur.execute("SELECT pg_advisory_xact_lock(71420261014)")
            cur.execute("SELECT EXISTS(SELECT 1 FROM studio_accounts) AS present")
            if cur.fetchone()["present"]:
                raise HTTPException(409, "تم إعداد الحساب الرئيسي بالفعل.")
            user_id = uuid.uuid4()
            cur.execute("INSERT INTO studio_accounts (id,email,password_hash,role) VALUES (%s,%s,%s,'owner')",
                        (user_id,email,_hasher.hash(payload.password)))
            _start_session(db,request,response,user_id)
        db.commit()
    return {"authenticated": True, "email": email, "role": "owner"}


@router.post("/account/login")
def login_account(payload: Credentials, request: Request, response: Response):
    _require_origin(request)
    email = _valid_email(payload.email)
    with _connection() as db:
        with db.cursor() as cur:
            cur.execute("SELECT id,password_hash,role,failed_logins,locked_until FROM studio_accounts WHERE email=%s FOR UPDATE",
                        (email,))
            record = cur.fetchone()
            if not record:
                # No account information is disclosed by the authentication response.
                raise HTTPException(401, "بيانات تسجيل الدخول غير صحيحة.")
            if record["locked_until"] and record["locked_until"] > _now():
                raise HTTPException(429, "تم إيقاف محاولات الدخول مؤقتًا. حاول لاحقًا.")
            try:
                ok = _hasher.verify(record["password_hash"], payload.password)
            except (argon_exceptions.VerifyMismatchError, argon_exceptions.VerificationError,
                    argon_exceptions.InvalidHashError):
                ok = False
            if not ok:
                failures = record["failed_logins"] + 1
                locked = _now() + timedelta(minutes=15) if failures >= 5 else None
                cur.execute("UPDATE studio_accounts SET failed_logins=%s,locked_until=%s WHERE id=%s",
                            (failures, locked, record["id"]))
                db.commit()
                raise HTTPException(401, "بيانات تسجيل الدخول غير صحيحة.")
            cur.execute("UPDATE studio_accounts SET failed_logins=0,locked_until=NULL WHERE id=%s", (record["id"],))
            _start_session(db,request,response,record["id"])
        db.commit()
    return {"authenticated": True, "email": email, "role": record["role"]}


@router.post("/account/logout")
def logout_account(request: Request, response: Response):
    _require_origin(request)
    token = request.cookies.get(COOKIE_NAME)
    if token and os.getenv("DATABASE_URL"):
        with _connection() as db:
            with db.cursor() as cur:
                cur.execute("DELETE FROM studio_sessions WHERE token_hash=%s", (_hash_token(token),))
            db.commit()
    response.delete_cookie(COOKIE_NAME, **_cookie_options(request))
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": False}


@router.post("/account/invite")
def invite_member(request: Request):
    _require_origin(request)
    user = _authorized_user(request)
    if user["role"] != "owner":
        raise HTTPException(403, "إنشاء الدعوات متاح لمدير المنصة فقط.")
    invitation = secrets.token_urlsafe(32)
    with _connection() as db:
        with db.cursor() as cur:
            cur.execute("INSERT INTO studio_invites(token_hash,created_by,expires_at) VALUES(%s,%s,%s)",
                        (_hash_token(invitation),user["id"],_now()+timedelta(days=7)))
        db.commit()
    return {"invitation": invitation, "expires_in_days": 7}


@router.post("/account/register")
def register_member(payload: Register, request: Request, response: Response):
    _require_origin(request)
    email = _valid_email(payload.email)
    _valid_password(payload.password)
    with _connection() as db:
        with db.cursor() as cur:
            cur.execute("SELECT token_hash FROM studio_invites WHERE token_hash=%s AND used_at IS NULL AND expires_at>now() FOR UPDATE",
                        (_hash_token(payload.invitation),))
            if not cur.fetchone():
                raise HTTPException(403, "رمز الدعوة غير صالح أو انتهت صلاحيته.")
            user_id = uuid.uuid4()
            try:
                cur.execute("INSERT INTO studio_accounts (id,email,password_hash,role) VALUES (%s,%s,%s,'member')",
                            (user_id,email,_hasher.hash(payload.password)))
            except errors.UniqueViolation as exc:
                raise HTTPException(409, "هذا البريد الإلكتروني مسجل مسبقًا.") from exc
            cur.execute("UPDATE studio_invites SET used_at=now() WHERE token_hash=%s",
                        (_hash_token(payload.invitation),))
            _start_session(db,request,response,user_id)
        db.commit()
    return {"authenticated": True, "email": email, "role": "member"}


def _row_project(row: dict):
    return {**row["data"], "version": row["version"], "updatedAt": row["updated_at"].isoformat(),
            "date": row["created_at"].isoformat()}


@router.get("/projects")
def list_projects(request: Request, response: Response):
    user = _authorized_user(request)
    with _connection() as db:
        with db.cursor() as cur:
            cur.execute("SELECT data,version,created_at,updated_at FROM studio_cloud_projects WHERE owner_id=%s ORDER BY updated_at DESC LIMIT %s",
                        (user["id"], MAX_PROJECTS))
            result = [_row_project(row) for row in cur.fetchall()]
    response.headers["Cache-Control"] = "no-store"
    return {"projects": result}


@router.put("/projects/{project_id}")
def put_project(project_id: uuid.UUID, payload: ProjectData, request: Request):
    _require_origin(request)
    user = _authorized_user(request)
    if payload.id != project_id:
        raise HTTPException(422, "معرف المشروع لا يطابق البيانات المرسلة.")
    data = payload.model_dump(mode="json",exclude={"version"})
    if len(json.dumps(data, ensure_ascii=False).encode("utf-8")) > MAX_PROJECT_JSON:
        raise HTTPException(413, "حجم المشروع يتجاوز الحد المسموح للحفظ السحابي.")
    with _connection() as db:
        with db.cursor() as cur:
            if payload.version == 0:
                cur.execute("SELECT COUNT(*) AS count FROM studio_cloud_projects WHERE owner_id=%s",
                            (user["id"],))
                if cur.fetchone()["count"] >= MAX_PROJECTS:
                    raise HTTPException(409, "بلغ حسابك الحد الأقصى 50 مشروعًا سحابيًا.")
                cur.execute("""
                    INSERT INTO studio_cloud_projects(id,owner_id,data,version)
                    VALUES (%s,%s,%s::jsonb,1) ON CONFLICT DO NOTHING RETURNING version,created_at,updated_at
                """, (project_id,user["id"],json.dumps(data,ensure_ascii=False)))
            else:
                cur.execute("""
                    UPDATE studio_cloud_projects
                    SET data=%s::jsonb,version=version+1,updated_at=now()
                    WHERE id=%s AND owner_id=%s AND version=%s
                    RETURNING version,created_at,updated_at
                """, (json.dumps(data,ensure_ascii=False),project_id,user["id"],payload.version))
            row = cur.fetchone()
            if not row:
                raise HTTPException(409, "تغير المشروع على جهاز آخر. حدّث المشاريع قبل استكمال التعديل.")
        db.commit()
    return {**data,"version":row["version"],"date":row["created_at"].isoformat(),
            "updatedAt":row["updated_at"].isoformat()}


@router.delete("/projects/{project_id}")
def delete_project(project_id: uuid.UUID, request: Request):
    _require_origin(request)
    user = _authorized_user(request)
    with _connection() as db:
        with db.cursor() as cur:
            cur.execute("DELETE FROM studio_cloud_projects WHERE id=%s AND owner_id=%s RETURNING id",
                        (project_id,user["id"]))
            deleted = cur.fetchone()
        db.commit()
    if not deleted:
        raise HTTPException(404, "المشروع غير موجود في حسابك.")
    return {"deleted": True}
