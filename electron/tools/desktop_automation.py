"""
CLI entrypoint for the Windows AutomationEngine.

Invoked as:  python desktop_automation.py '<json command>'

Keeps the exact same stdout contract as before (a single JSON object printed
to stdout) so the Node/Electron side (desktop_automation.ts) does not need to
change how it invokes this script — only how it interprets the richer
response payload (method / verified / logs).
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


def main():
    if len(sys.argv) < 2:
        print(json.dumps(_result("error", "No command provided")))
        return

    engine = AutomationEngine()

    try:
        data = json.loads(sys.argv[1])
    except Exception as e:
        print(json.dumps(_result("error", f"Invalid JSON arguments: {e}")))
        return

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

        else:
            res = _result("error", f"Unknown command '{cmd}'", logs=engine.logs)

    except AutomationError as e:
        res = _result("error", str(e), logs=engine.logs)
    except Exception as e:
        res = _result("error", f"Exception: {e}", logs=engine.logs)

    print(json.dumps(res))


if __name__ == "__main__":
    main()
