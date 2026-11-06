import json, re
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

STATE = {
    "token_n": 0,
    "us": {101: {"id": 101, "ref": 42, "project": 1, "subject": "Login SSO", "description": "",
                 "status": 1, "assigned_to": None, "milestone": None, "tags": [], "version": 1,
                 "is_closed": False}},
    "tasks": {},
    "comments": [],
}
STATUSES = [{"id": 1, "name": "New", "slug": "new", "is_closed": False, "order": 1},
            {"id": 2, "name": "In progress", "slug": "in-progress", "is_closed": False, "order": 2},
            {"id": 3, "name": "Done", "slug": "done", "is_closed": True, "order": 3}]
MEMBERS = [{"id": 9, "user": 7, "full_name": "Daniele Pompa", "username": "daniele", "user_email": "d@20tab.com"},
           {"id": 8, "user": 5, "full_name": "Raffaele Colace", "username": "raffaele", "user_email": "raffaele@20tab.com"}]
SPRINTS = [{"id": 30, "name": "Sprint 12", "slug": "sprint-12", "estimated_start": "2026-11-02",
            "estimated_finish": "2026-11-13", "closed": False, "user_stories": []}]
EXPIRE_NEXT = {"v": True}


def deco(o, kind):
    st = {s["id"]: s for s in STATUSES}[o["status"]]
    o.setdefault("created_date", "2026-11-01T09:00:00Z")
    o.setdefault("modified_date", o["created_date"])
    if st["is_closed"] and not o.get("finish_date"):
        o["finish_date"] = "2026-11-05T10:00:00Z"
    o = dict(o, status_extra_info={"name": st["name"]}, is_closed=st["is_closed"])
    m = {x["user"]: x for x in MEMBERS}.get(o.get("assigned_to"))
    o["assigned_to_extra_info"] = {"full_name_display": m["full_name"]} if m else None
    return o


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, code, obj=None):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if obj is not None:
            self.wfile.write(json.dumps(obj).encode())

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n)) if n else {}

    def authed(self):
        tok = self.headers.get("Authorization", "")
        if tok != f"Bearer tok{STATE['token_n']}":
            self.send(401, {"detail": "Invalid token"}); return False
        return True

    def route(self, method):
        u = urlparse(self.path); p = u.path.replace("/api/v1/", ""); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if p == "auth" and method == "POST":
            b = self.body()
            if b.get("password") != "segreta":
                return self.send(400, {"_error_message": "Username or password is incorrect."})
            STATE["token_n"] += 1
            return self.send(200, {"auth_token": f"tok{STATE['token_n']}", "refresh": "r", "id": 5,
                                   "username": "raffaele", "full_name": "Raffaele Colace"})
        if p == "auth/refresh":
            STATE["token_n"] += 1
            return self.send(200, {"auth_token": f"tok{STATE['token_n']}", "refresh": "r2"})
        if not self.authed():
            return
        if p == "users/me":
            return self.send(200, {"id": 5, "username": "raffaele", "full_name": "Raffaele Colace", "email": "raffaele@20tab.com"})
        if p == "projects":
            return self.send(200, [{"id": 1, "slug": "growth", "name": "Growth"}])
        if p in ("projects/by_slug", "projects/1"):
            return self.send(200, {"id": 1, "slug": "growth", "name": "Growth",
                                   "us_statuses": STATUSES, "task_statuses": STATUSES, "issue_statuses": STATUSES,
                                   "members": [{"id": m["user"], "full_name_display": m["full_name"], "username": m["username"]} for m in MEMBERS]})
        if p in ("userstory-statuses", "task-statuses"):
            return self.send(200, STATUSES)
        if p == "memberships":
            return self.send(200, MEMBERS)
        if p == "milestones" and method == "GET":
            return self.send(200, SPRINTS)
        coll = {"userstories": "us", "tasks": "tasks"}
        m = re.match(r"(userstories|tasks)(?:/(\w+))?$", p)
        if m:
            store = STATE[coll[m.group(1)]]; kind = m.group(1); sub = m.group(2)
            if sub == "by_ref":
                for o in store.values():
                    if str(o["ref"]) == q["ref"]:
                        return self.send(200, deco(o, kind))
                return self.send(404, {"_error_message": "No UserStory matches the given query."})
            if sub is None and method == "GET":
                items = list(store.values())
                if "user_story" in q:
                    items = [i for i in items if str(i.get("user_story")) == q["user_story"]]
                if "assigned_to" in q:
                    items = [i for i in items if str(i.get("assigned_to")) == q["assigned_to"]]
                return self.send(200, [deco(i, kind) for i in items])
            if sub is None and method == "POST":
                b = self.body(); nid = 200 + len(store); ref = 43 + len(STATE["us"]) + len(STATE["tasks"])
                o = {"id": nid, "ref": ref, "status": 1, "assigned_to": None, "milestone": None,
                     "tags": [], "version": 1, "description": ""} | b
                store[nid] = o
                return self.send(201, deco(o, kind))
            if sub == "bulk_create":
                b = self.body(); out = []
                for line in (b.get("bulk_tasks") or b.get("bulk_stories")).split("\n"):
                    nid = 300 + len(store); o = {"id": nid, "ref": 60 + len(store), "subject": line, "status": 1,
                                                  "version": 1, "project": 1, "user_story": b.get("us_id")}
                    store[nid] = o; out.append(deco(o, kind))
                return self.send(200, out)
            if sub and sub.isdigit():
                o = store[int(sub)]
                if method == "GET":
                    return self.send(200, deco(o, kind))
                if method == "PATCH":
                    b = self.body()
                    if b.get("version") != o["version"]:
                        return self.send(400, {"version": "The version doesn't match with the current one"})
                    if "comment" in b:
                        STATE["comments"].append(b.pop("comment"))
                    b.pop("version"); o.update(b); o["version"] += 1
                    return self.send(200, deco(o, kind))
                if method == "DELETE":
                    del store[int(sub)]; return self.send(204)
        self.send(404, {"detail": f"no route {method} {p}"})

    def do_GET(self): self.route("GET")
    def do_POST(self): self.route("POST")
    def do_PATCH(self): self.route("PATCH")
    def do_DELETE(self): self.route("DELETE")


HTTPServer(("127.0.0.1", 8765), H).serve_forever()
