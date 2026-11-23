#!/usr/bin/env python3
"""Переносит правки со страницы /admin/ в Google Таблицу.

Запускается на GitHub Actions перед сборкой сайта. Сервисный аккаунт получает токен,
читает очередь Firestore: правки edits/{id} (status == new) и заявки с сайта
submissions/{id} (status == approved). Пишет значения в листы «Номера» / «Концерты» /
«Люди», дописывает строку в журнал «Заявки» и помечает документ как applied (или
error). После этого build.py собирает сайт из обновлённой таблицы, и правку видят все.

Переменные окружения:
  GOOGLE_SA_JSON  — содержимое JSON сервисного аккаунта (секрет в GitHub)
  SHEET_ID        — ID таблицы (обычно общий с шагами сборки)
  GOOGLE_SA_FILE  — путь к JSON вместо содержимого (для локальной проверки)

Скрипт ничего не делает, если секрета нет: сборка сайта без правок работает как раньше.
"""
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/datastore"
TOKEN_URL = "https://oauth2.googleapis.com/token"
FS = "https://firestore.googleapis.com/v1"
SH = "https://sheets.googleapis.com/v4/spreadsheets"

# Поле правки -> возможные заголовки колонки в таблице (как в SPEC build.py)
COLS = {
    "number": {
        "sheet": "Номера",
        "id": ["id"],
        "fields": {
            "title": ["название"],
            "collective": ["коллектив"],
            "concert": ["концерт"],
            "direction": ["направление"],
            "direction2": ["ещё направление", "еще направление", "второе направление"],
            "performers": ["участники", "исполнители"],
            "choreographers": ["постановщики"],
            "about": ["описание"],
            "cover": ["обложка"],
            "start": ["начало"],
            "end": ["конец"],
            "old_url": ["старый адрес"],
            "links": ["ссылки", "соцсети", "группа"],
            "track": ["трек", "саундтрек"],
        },
    },
    "concert": {
        "sheet": "Концерты",
        "id": ["id"],
        "fields": {
            "name": ["название"],
            "date": ["дата"],
            "video": ["видео", "ссылка на видео"],
            "video2": ["видео 2", "видео2"],
            "about": ["описание"],
            "cover": ["обложка"],
            "topic": ["тема"],
            "season": ["учебный год", "поколение"],
            "year": ["год"],
            "ctype": ["тип концерта", "вид концерта"],
            "playlist": ["плейлист", "плейлист концерта", "музыка"],
        },
    },
    "person": {
        "sheet": "Люди",
        "id": ["id"],
        "fields": {
            "name": ["имя"],
            "about": ["о себе", "описание"],
            "link": ["ссылка"],
        },
    },
}
KIND_RU = {"number": "Номер", "concert": "Концерт", "person": "Человек"}


def log(m):
    print(m, flush=True)


def norm(s):
    s = str(s or "").lower().replace("ё", "е")
    return re.sub(r"[^0-9a-zа-я]+", "", s)


# ---------------------------------------------------------------- ключ и токен
def service_account():
    raw = os.environ.get("GOOGLE_SA_JSON", "").strip()
    if not raw:
        path = os.environ.get("GOOGLE_SA_FILE", "").strip()
        if not path:
            return None
        with open(path, encoding="utf-8") as f:
            raw = f.read()
    try:
        return json.loads(raw)
    except ValueError:
        log("::error::GOOGLE_SA_JSON не похож на JSON — проверьте секрет репозитория.")
        return None


def b64u(b):
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def access_token(sa):
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    now = int(time.time())
    header = {"alg": "RS256", "typ": "JWT"}
    claims = {"iss": sa["client_email"], "scope": SCOPES, "aud": TOKEN_URL, "iat": now, "exp": now + 3500}
    signing_input = (b64u(json.dumps(header).encode()) + "." + b64u(json.dumps(claims).encode())).encode()
    key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
    sig = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    assertion = signing_input.decode() + "." + b64u(sig)
    body = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": assertion,
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["access_token"]


# ---------------------------------------------------------------- HTTP
def api(url, token, method="GET", data=None, quiet=False):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        if quiet:
            return {"_error": e.code, "_text": text}
        raise RuntimeError(f"{method} {url} -> {e.code}: {text[:500]}")


# ---------------------------------------------------------------- Firestore
def queue(project, token, coll, status, limit):
    url = f"{FS}/projects/{project}/databases/(default)/documents:runQuery"
    q = {"structuredQuery": {
        "from": [{"collectionId": coll}],
        "where": {"fieldFilter": {"field": {"fieldPath": "status"}, "op": "EQUAL", "value": {"stringValue": status}}},
        "limit": limit,
    }}
    res = api(url, token, "POST", q)
    out = []
    for item in res:
        doc = item.get("document")
        if doc:
            out.append((doc["name"].rsplit("/", 1)[1], plain(doc.get("fields", {}))))
    return out


def plain(fields):
    def one(f):
        for t, v in f.items():
            if t == "stringValue":
                return v
            if t == "timestampValue":
                return v
            if t == "integerValue":
                return int(v)
            if t == "booleanValue":
                return bool(v)
            if t == "mapValue":
                return {k: one(x) for k, x in v.get("fields", {}).items()}
        return ""
    return {k: one(v) for k, v in fields.items()}


def mark(project, token, coll, doc_id, status, error=None):
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    fields = {"status": {"stringValue": status}, "appliedAt": {"timestampValue": now}}
    if error:
        fields["error"] = {"stringValue": error[:500]}
    mask = "&".join("updateMask.fieldPaths=" + urllib.parse.quote(k, safe="") for k in fields)
    url = f"{FS}/projects/{project}/databases/(default)/documents/{coll}/{doc_id}?{mask}"
    api(url, token, "PATCH", {"fields": fields})


# ---------------------------------------------------------------- Sheets
def sheet_values(sheet_id, name, token):
    rng = urllib.parse.quote(f"'{name}'", safe="")
    res = api(f"{SH}/{sheet_id}/values/{rng}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE", token)
    return res.get("values", [])


def col_letter(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def write_row_fields(sheet_id, token, kind, target, fields, cache):
    """Пишет значения полей в строку листа по ID.

    Возвращает (текст ошибки или None, список записанных полей).
    """
    spec = COLS.get(kind)
    if not spec:
        return "неизвестный тип правки «%s»" % kind, []
    target = str(target or "").strip()
    if not target:
        return "не указан ID строки", []
    fields = fields or {}
    if not fields:
        return "нечего записывать: пустой набор полей", []
    sheet = spec["sheet"]
    if sheet not in cache:
        cache[sheet] = sheet_values(sheet_id, sheet, token)
    rows = cache[sheet]
    if not rows:
        return f"лист «{sheet}» пустой", []
    head = [norm(h) for h in rows[0]]
    id_col = next((head.index(norm(h)) for h in spec["id"] if norm(h) in head), None)
    if id_col is None:
        return f"в листе «{sheet}» не нашлась колонка ID", []
    row_i = None
    for i, r in enumerate(rows[1:], start=2):
        if len(r) > id_col and str(r[id_col]).strip() == target:
            row_i = i
            break
    if row_i is None:
        return f"в таблице нет строки с ID «{target}» — возможно, её переименовали", []

    updates, used = [], []
    for key, value in fields.items():
        names = spec["fields"].get(key)
        if not names:
            continue
        idx = next((head.index(norm(h)) for h in names if norm(h) in head), None)
        if idx is None:
            continue
        rng = f"'{sheet}'!{col_letter(idx)}{row_i}"
        updates.append({"range": rng, "values": [[str(value)]]})
        used.append(key)
    if not updates:
        return "ни одна колонка не нашлась в таблице (изменились заголовки?)", []

    api(f"{SH}/{sheet_id}/values:batchUpdate", token, "POST",
        {"valueInputOption": "RAW", "data": updates})
    cache.pop(sheet, None)  # следующая правка того же листа прочитает свежие данные
    return None, used


def journal_row(sheet_id, token, row):
    rng = urllib.parse.quote("'Заявки'!A1", safe="")
    api(f"{SH}/{sheet_id}/values/{rng}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", token, "POST",
        {"values": [row]}, quiet=True)


def journal(sheet_id, token, edit, used):
    fields = edit.get("fields") or {}
    brief = "; ".join(f"{k}: {str(v)[:80]}" for k, v in list(fields.items())[:6])
    journal_row(sheet_id, token, [
        time.strftime("%d.%m.%Y %H:%M", time.gmtime()),
        edit.get("email", "site"),
        f"Правка с сайта: {KIND_RU.get(edit.get('kind'), '')} {edit.get('targetId', '')}",
        brief,
        "Принять",
        "Применено: " + ", ".join(used),
        json.dumps({"kind": "site-edit", "data": fields}, ensure_ascii=False),
    ])


def journal_sub(sheet_id, token, sub, used):
    fields = sub.get("fields") or {}
    brief = "; ".join(f"{k}: {str(v)[:80]}" for k, v in list(fields.items())[:6])
    who = ", ".join(x for x in [sub.get("authorName"), sub.get("authorNick"), sub.get("authorEmail")] if x)
    journal_row(sheet_id, token, [
        time.strftime("%d.%m.%Y %H:%M", time.gmtime()),
        sub.get("authorEmail") or "site",
        f"Заявка с сайта: номер {sub.get('targetId', '')}",
        brief,
        "Принять",
        "Применено: " + ", ".join(used),
        json.dumps({"kind": "site-request", "data": {
            "number": sub.get("targetId", ""),
            "concert": sub.get("concert", ""),
            "author": who,
            "fields": fields,
        }}, ensure_ascii=False),
    ])


def apply_edit(sheet_id, token, edit, cache):
    err, used = write_row_fields(sheet_id, token, edit.get("kind"),
                                 edit.get("targetId") or "", edit.get("fields") or {}, cache)
    if err:
        return err
    journal(sheet_id, token, edit, used)
    return None


def apply_submission(sheet_id, token, sub, cache):
    err, used = write_row_fields(sheet_id, token, "number",
                                 sub.get("targetId") or "", sub.get("fields") or {}, cache)
    if err:
        return err
    journal_sub(sheet_id, token, sub, used)
    return None


def main():
    sa = service_account()
    if not sa:
        log("Секрет GOOGLE_SA_JSON не задан — правки с сайта пропускаю, собираю сайт из таблицы как есть.")
        return 0
    sheet_id = os.environ.get("SHEET_ID", "").strip()
    if not sheet_id:
        log("::error::Не задан SHEET_ID — не знаю, какую таблицу править.")
        return 1
    project = sa.get("project_id", "")
    log(f"Сервисный аккаунт: {sa.get('client_email')}, проект {project}, таблица {sheet_id}")
    token = access_token(sa)
    cache = {}

    done = failed = 0
    items = queue(project, token, "edits", "new", 50)
    log(f"Правок в очереди: {len(items)}")
    for doc_id, edit in items:
        try:
            err = apply_edit(sheet_id, token, edit, cache)
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {e}"
        if err:
            failed += 1
            log(f"  правка {doc_id} ({edit.get('kind')} {edit.get('targetId')}): {err}")
            try:
                mark(project, token, "edits", doc_id, "error", err)
            except Exception:  # noqa: BLE001
                pass
        else:
            done += 1
            log(f"  правка {doc_id}: применено ({edit.get('kind')} {edit.get('targetId')})")
            mark(project, token, "edits", doc_id, "applied")

    sub_done = sub_failed = 0
    subs = queue(project, token, "submissions", "approved", 30)
    log(f"Заявок с сайта к переносу: {len(subs)}")
    for doc_id, sub in subs:
        try:
            err = apply_submission(sheet_id, token, sub, cache)
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {e}"
        if err:
            sub_failed += 1
            log(f"  заявка {doc_id} (номер {sub.get('targetId')}): {err}")
            try:
                mark(project, token, "submissions", doc_id, "error", err)
            except Exception:  # noqa: BLE001
                pass
        else:
            sub_done += 1
            log(f"  заявка {doc_id}: перенесена (номер {sub.get('targetId')})")
            mark(project, token, "submissions", doc_id, "applied")

    log(f"Готово: правок применено {done}, с ошибкой {failed}; заявок перенесено {sub_done}, с ошибкой {sub_failed}.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        log(f"::error::Правки с сайта не применились: {type(exc).__name__}: {exc}")
        sys.exit(0)  # сборку сайта из таблицы это не должно останавливать
