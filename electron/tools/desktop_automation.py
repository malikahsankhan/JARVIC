import sys
import json
import re
from pywinauto import Desktop, Application
from pywinauto.findwindows import ElementNotFoundError, ElementAmbiguousError

def list_windows():
    windows = []
    # Get all top-level windows
    for win in Desktop(backend="uia").windows():
        title = win.window_text()
        if title:
            windows.append({
                "title": title,
                "class_name": win.class_name(),
                "handle": win.handle
            })
    return {"status": "success", "windows": windows}

def dump_controls(window_title):
    try:
        win = Desktop(backend="uia").window(title_re=window_title)
        controls = []
        for ctrl in win.descendants():
            controls.append({
                "text": ctrl.window_text(),
                "control_type": ctrl.element_info.control_type,
                "auto_id": ctrl.element_info.automation_id,
                "class_name": ctrl.element_info.class_name
            })
        return {"status": "success", "controls": controls}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def click_control(window_title, control_text=None, auto_id=None, control_type=None):
    try:
        win = Desktop(backend="uia").window(title_re=window_title)
        win.set_focus()
        
        # Build search criteria
        criteria = {}
        if control_text:
            criteria["title"] = control_text
        if auto_id:
            criteria["auto_id"] = auto_id
        if control_type:
            criteria["control_type"] = control_type
            
        ctrl = win.child_window(**criteria)
        ctrl.click_input()
        return {"status": "success", "message": f"Clicked control in window '{window_title}'"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def type_control(window_title, text, control_text=None, auto_id=None, control_type=None):
    try:
        win = Desktop(backend="uia").window(title_re=window_title)
        win.set_focus()
        
        criteria = {}
        if control_text:
            criteria["title"] = control_text
        if auto_id:
            criteria["auto_id"] = auto_id
        if control_type:
            criteria["control_type"] = control_type
            
        if criteria:
            ctrl = win.child_window(**criteria)
            ctrl.click_input()
            ctrl.type_keys(text, with_spaces=True)
        else:
            # Type into current focused item or window directly
            win.type_keys(text, with_spaces=True)
            
        return {"status": "success", "message": f"Typed text into window '{window_title}'"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "No command provided"}))
        return

    try:
        data = json.loads(sys.argv[1])
        cmd = data.get("command")
        
        if cmd == "list_windows":
            res = list_windows()
        elif cmd == "dump_controls":
            res = dump_controls(data.get("window_title"))
        elif cmd == "click_control":
            res = click_control(
                data.get("window_title"),
                control_text=data.get("control_text"),
                auto_id=data.get("auto_id"),
                control_type=data.get("control_type")
            )
        elif cmd == "type_control":
            res = type_control(
                data.get("window_title"),
                data.get("text"),
                control_text=data.get("control_text"),
                auto_id=data.get("auto_id"),
                control_type=data.get("control_type")
            )
        else:
            res = {"status": "error", "message": f"Unknown command '{cmd}'"}
            
        print(json.dumps(res))
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Exception: {str(e)}"}))

if __name__ == "__main__":
    main()
