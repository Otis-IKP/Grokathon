from nepo_bot.backend import stub


def test_resolve_ysig():
    out = stub.resolve_club("I want YSIG")
    assert out["ok"] is True
    assert out["club"]["id"] == "ysig"


def test_maya_has_jordan_path():
    out = stub.find_paths("user_maya", "ysig")
    assert out["ok"] is True
    assert out["count"] >= 1
    top = out["paths"][0]
    assert top["connector"]["id"] == "user_jordan"
    assert top["hops"] == 1


def test_draft_intro():
    out = stub.draft_intro("user_maya", "user_jordan", "ysig")
    assert out["ok"] is True
    assert "Jordan" in out["body"]
    assert out["to_phone"].startswith("+1")
