"""Статические данные для сайта: аватары пользователей и пустые сводки оценок.

Запускается в GitHub Actions после сборки сайта (секрет GOOGLE_SA_JSON):

1. Выгружает users/* (аватар, ник, имя, ссылки) в site/avatars.json — страницы
   берут фото и имена из одного файла, а не читают документы из Firestore.
   Раз в сутки при сборке этого достаточно: смена аватара появится на сайте
   после ближайшей сборки.
2. Создаёт rateAgg/<номер> с нулями там, где сводки ещё нет: страница номера
   читает один документ вместо всех оценок.

Скрипт идемпотентный: повторный запуск ничего не ломает и не перезаписывает
существующие сводки.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import apply_edits as ae  # noqa: E402

PROJECT = os.environ.get("FIREBASE_PROJECT", "socgum-catalog-sandbox")
ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
BASE = f"{ae.FS}/projects/{PROJECT}/databases/(default)/documents"


def list_docs(token, coll, page=300):
    """Все документы коллекции (с постраничной догрузкой)."""
    out = []
    url = f"{BASE}/{coll}?pageSize={page}"
    while url:
        data = ae.api(url, token)
        out.extend(data.get("documents", []))
        token_next = data.get("nextPageToken")
        url = f"{BASE}/{coll}?pageSize={page}&pageToken={token_next}" if token_next else None
    return out


def doc_id(doc):
    return doc.get("name", "").rsplit("/", 1)[-1]


def text(fields, key):
    v = (fields or {}).get(key) or {}
    return v.get("stringValue", "")


def main():
    sa = ae.service_account()
    if not sa:
        print("Секрет GOOGLE_SA_JSON не задан — статические данные пропускаю…")
        return 0
    token = ae.access_token(sa)

    # 1. Аватары и имена: users/{uid} -> avatars.json
    users = {}
    for d in list_docs(token, "users"):
        uid = doc_id(d)
        f = d.get("fields", {})
        users[uid] = {
            "a": text(f, "avatar"),
            "n": text(f, "nick"),
            "m": text(f, "name"),
            "l": ae.plain(f.get("links") or {}) or {},
        }
    SITE.mkdir(parents=True, exist_ok=True)
    avatars = SITE / "avatars.json"
    avatars.write_text(json.dumps(users, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Аватары: {len(users)} пользователей → site/avatars.json ({avatars.stat().st_size} байт)")

    # 2. Пустые сводки оценок для номеров, у которых их ещё нет
    admin = SITE / "admin.json"
    numbers = []
    if admin.exists():
        try:
            numbers = [n.get("id") for n in json.loads(admin.read_text(encoding="utf-8")).get("numbers", []) if n.get("id")]
        except Exception as e:
            print("admin.json не прочитался:", e)
    have = {doc_id(d) for d in list_docs(token, "rateAgg")}
    zeros = {"n": 0, "absent": 0, "idea": 0, "comp": 0, "perf": 0, "stage": 0, "overall": 0}
    made = 0
    for nid in numbers:
        if nid in have:
            continue
        body = {"fields": {k: {"integerValue": str(v)} for k, v in zeros.items()}}
        ae.api(f"{BASE}/rateAgg?documentId={nid}", token, method="POST", data=body)
        made += 1
    print(f"Сводки оценок: создано {made}, было {len(have)}, всего номеров {len(numbers)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # сборку сайта не валим
        print("::error::Статические данные не собрались:", exc)
        sys.exit(0)
