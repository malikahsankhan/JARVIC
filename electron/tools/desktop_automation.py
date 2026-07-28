"""
CLI / long-running-worker entrypoint for the Windows AutomationEngine.

Two modes:

  1. One-shot (legacy, kept for backward compatibility / manual debugging):
         python desktop_automation.py '<json command>'
     Creates a fresh AutomationEngine, runs one command, prints one JSON
     line to stdout, exits.

  2. Persistent worker (used by desktop_automation.ts in production):
         python desktop_automation.py --serve
     Creates ONE AutomationEngine (heavy pywinauto/uiautomation/pywin32
     imports happen exactly once, at process start), then loops forever
     reading one JSON command per line from stdin and writing one JSON
     result per line to stdout. This avoids the ~1-2.5s cold-start cost
     of re-importing those libraries on every single tool call.

Both modes share the same dispatch() function so behavior is identical —
only the process lifecycle differs.
"""

import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))

from automation_engine import AutomationEngine, AutomationError  # noqa: E402


def _result(status, message, method=None, verified=None, data=None, logs=None):
    return {
        "status": status,
        "message": message,
        "method": method,
        "verified": verified,
        "data": data,
        "logs": logs or [],
    }


def dispatch(engine: AutomationEngine, data: dict) -> dict:
    """Runs exactly one command against the given engine and returns a result dict.
    Caller is responsible for resetting engine.logs before calling this if the
    engine instance is being reused across multiple commands (persistent mode)."""

    cmd = data.get("command")

    try:
        if cmd == "list_windows":
            windows = engine.list_windows()
            res = _result("success", f"Found {len(windows)} window(s)", data={"windows": windows}, logs=engine.logs)

        elif cmd == "get_active_window":
            win = engine.get_active_window()
            res = _result("success", "Retrieved active window", data={"window": win}, logs=engine.logs)

        elif cmd == "dump_controls":
            win = engine._find_window(data.get("window_title"))
            controls = engine.list_controls(win)
            res = _result("success", f"Found {len(controls)} control(s)", data={"controls": controls}, logs=engine.logs)

        elif cmd in ("click_control", "double_click_control", "right_click_control"):
            win = engine._find_window(data.get("window_title"))
            win.set_focus()
            ctrl = engine.find_control(
                win,
                name=data.get("control_text"),
                auto_id=data.get("auto_id"),
                control_type=data.get("control_type"),
                class_name=data.get("class_name"),
            )
            before = engine.snapshot(ctrl)
            click_type = {"click_control": "left", "double_click_control": "double", "right_click_control": "right"}[cmd]
            method = engine.click(ctrl, click_type=click_type)
            verified = engine.verify_click(ctrl, before)
            res = _result(
                "success",
                f"Clicked control in window '{data.get('window_title')}'",
                method=method,
                verified=verified,
                logs=engine.logs,
            )

        elif cmd == "type_control":
            win = engine._find_window(data.get("window_title"))
            win.set_focus()
            text = data.get("text", "")
            criteria_given = any([data.get("control_text"), data.get("auto_id"), data.get("control_type"), data.get("class_name")])
            if criteria_given:
                ctrl = engine.find_control(
                    win,
                    name=data.get("control_text"),
                    auto_id=data.get("auto_id"),
                    control_type=data.get("control_type"),
                    class_name=data.get("class_name"),
                )
                engine.set_focus(ctrl)
                method = engine.type_text(ctrl, text)
                verified = engine.verify_type(ctrl, text)
            else:
                method = engine.type_text(win, text)
                verified = engine.verify_type(win, text)
            res = _result(
                "success",
                f"Typed text into window '{data.get('window_title')}'",
                method=method,
                verified=verified,
                logs=engine.logs,
            )

        elif cmd == "press_key":
            win = None
            if data.get("window_title"):
                win = engine._find_window(data.get("window_title"))
                win.set_focus()
            ctrl = None
            if win is not None and any([data.get("control_text"), data.get("auto_id")]):
                ctrl = engine.find_control(win, name=data.get("control_text"), auto_id=data.get("auto_id"))
            engine.press_key(data.get("key"), ctrl=ctrl)
            res = _result("success", f"Pressed key '{data.get('key')}'", logs=engine.logs)

        elif cmd == "select_item":
            win = engine._find_window(data.get("window_title"))
            win.set_focus()
            ctrl = engine.find_control(
                win,
                name=data.get("control_text"),
                auto_id=data.get("auto_id"),
                control_type=data.get("control_type"),
                class_name=data.get("class_name"),
            )
            method = engine.select_item(ctrl, name=data.get("item_name"))
            res = _result("success", "Selected item", method=method, logs=engine.logs)

        elif cmd in ("expand_control", "collapse_control"):
            win = engine._find_window(data.get("window_title"))
            win.set_focus()
            ctrl = engine.find_control(
                win,
                name=data.get("control_text"),
                auto_id=data.get("auto_id"),
                control_type=data.get("control_type"),
                class_name=data.get("class_name"),
            )
            method = engine.expand(ctrl) if cmd == "expand_control" else engine.collapse(ctrl)
            res = _result("success", cmd.replace("_", " "), method=method, logs=engine.logs)

        elif cmd == "scroll_control":
            win = engine._find_window(data.get("window_title"))
            win.set_focus()
            ctrl = engine.find_control(
                win,
                name=data.get("control_text"),
                auto_id=data.get("auto_id"),
                control_type=data.get("control_type"),
                class_name=data.get("class_name"),
            )
            method = engine.scroll(ctrl, direction=data.get("direction", "down"), amount=data.get("amount", 3))
            res = _result("success", "Scrolled control", method=method, logs=engine.logs)

        elif cmd == "set_focus":
            win = engine._find_window(data.get("window_title"))
            ctrl = win
            if any([data.get("control_text"), data.get("auto_id")]):
                ctrl = engine.find_control(win, name=data.get("control_text"), auto_id=data.get("auto_id"))
            engine.set_focus(ctrl)
            res = _result("success", "Focus set", logs=engine.logs)

        elif cmd == "send_keys_to_window":
            win = engine._find_window(data.get("window_title"))
            win.set_focus()
            ctrl = None
            if any([data.get("control_text"), data.get("auto_id")]):
                ctrl = engine.find_control(win, name=data.get("control_text"), auto_id=data.get("auto_id"))
            engine.press_key(data.get("key"), ctrl=ctrl)
            res = _result("success", f"Sent key '{data.get('key')}' to window", logs=engine.logs)

        elif cmd == "move_window":
            win = engine._find_window(data.get("window_title"))
            result = engine.move_window(win, data.get("x", 0), data.get("y", 0))
            res = _result("success", "Window moved", data=result, logs=engine.logs)

        elif cmd == "resize_window":
            win = engine._find_window(data.get("window_title"))
            result = engine.resize_window(win, data.get("width", 800), data.get("height", 600))
            res = _result("success", "Window resized", data=result, logs=engine.logs)

        elif cmd == "set_window_state":
            win = engine._find_window(data.get("window_title"))
            result = engine.set_window_state(win, data.get("state"))
            res = _result("success", f"Window state set to '{data.get('state')}'", data=result, logs=engine.logs)

        elif cmd == "close_window":
            win = engine._find_window(data.get("window_title"))
            result = engine.close_window(win)
            res = _result("success", "Close signal sent to window", data=result, logs=engine.logs)

        elif cmd == "snap_window":
            win = engine._find_window(data.get("window_title"))
            result = engine.snap_window(win, data.get("position"))
            res = _result("success", f"Window snapped to '{data.get('position')}'", data=result, logs=engine.logs)

        elif cmd == "move_window_to_monitor":
            win = engine._find_window(data.get("window_title"))
            result = engine.move_to_monitor(win, data.get("monitor_index", 0))
            res = _result("success", "Window moved to monitor", data=result, logs=engine.logs)

        elif cmd == "list_monitors":
            monitors = engine.list_monitors()
            res = _result("success", f"Found {len(monitors)} monitor(s)", data={"monitors": monitors}, logs=engine.logs)

        elif cmd == "ping":
            # Cheap liveness check used by the Node side to confirm the
            # worker is up and its imports have finished, without touching
            # any real window/control.
            res = _result("success", "pong", logs=engine.logs)

        else:
            res = _result("error", f"Unknown command '{cmd}'", logs=engine.logs)

    except AutomationError as e:
        res = _result("error", str(e), logs=engine.logs)
    except Exception as e:
        res = _result("error", f"Exception: {e}", logs=engine.logs)

    return res


def run_one_shot():
    """Legacy mode: python desktop_automation.py '<json>'"""
    if len(sys.argv) < 2:
        print(json.dumps(_result("error", "No command provided")))
        return

    engine = AutomationEngine()

    try:
        data = json.loads(sys.argv[1])
    except Exception as e:
        print(json.dumps(_result("error", f"Invalid JSON arguments: {e}")))
        return

    print(json.dumps(dispatch(engine, data)))


def run_serve():
    """Persistent mode: python desktop_automation.py --serve

    Reads one JSON object per line from stdin (each with an "id" field added
    by the Node side for request/response correlation), dispatches it against
    a single long-lived engine, and writes one JSON object per line to
    stdout with that same "id" echoed back."""

    engine = AutomationEngine()

    # Signal readiness once heavy imports + engine construction are done, so
    # the Node side's first real request doesn't race the startup cost.
    sys.stdout.write(json.dumps({"id": None, **_result("success", "worker_ready")}) + "\n")
    sys.stdout.flush()

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        req_id = None
        try:
            data = json.loads(line)
            req_id = data.get("id")
            # Each command starts with a clean log trail; engine.logs is
            # otherwise cumulative across the lifetime of this instance.
            engine.logs = []
            res = dispatch(engine, data)
        except Exception as e:
            res = _result("error", f"Worker-level exception: {e}")

        res["id"] = req_id
        sys.stdout.write(json.dumps(res) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--serve":
        run_serve()
    else:
        run_one_shot()
