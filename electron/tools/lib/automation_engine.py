"""
AutomationEngine
================

Production Windows UI Automation engine for Jarvic.

Priority stack (never stops after a single failure):
    1. pywinauto (UIA backend)
    2. uiautomation (Python UIAutomation library)
    3. Win32 APIs (win32gui / win32api / win32process via pywin32)
    4. Mouse / keyboard simulation (last resort)

Every public action returns a dict:
    {
        "status": "success" | "error",
        "message": str,
        "method": str | None,     # which strategy actually worked
        "verified": bool | None,  # True/False if verifiable, None if unknown
        "data": Any,              # command-specific payload
        "logs": [str, ...]        # full attempt trail, in order
    }

This module has ZERO dependency on the rest of the Jarvic project — it only
talks to Windows. It is invoked by desktop_automation.py (the CLI entrypoint).
"""

import re
import time
import ctypes
from ctypes import wintypes

# ---------------------------------------------------------------------------
# Optional backends. The engine must be importable and at least partially
# functional even if some of these are missing, so every import is guarded.
# ---------------------------------------------------------------------------

try:
    from pywinauto import Desktop, Application
    from pywinauto.findwindows import ElementNotFoundError, ElementAmbiguousError
    PYWINAUTO_AVAILABLE = True
except Exception:
    PYWINAUTO_AVAILABLE = False
    ElementNotFoundError = Exception
    ElementAmbiguousError = Exception

try:
    import uiautomation as auto
    UIAUTOMATION_AVAILABLE = True
except Exception:
    UIAUTOMATION_AVAILABLE = False

try:
    import win32gui
    import win32api
    import win32con
    import win32process
    PYWIN32_AVAILABLE = True
except Exception:
    PYWIN32_AVAILABLE = False


class AutomationError(Exception):
    """Raised when every strategy in a fallback chain has been exhausted."""


# ---------------------------------------------------------------------------
# Low level Win32 helpers (used only once higher-level backends fail)
# ---------------------------------------------------------------------------

def _win32_click_at(x: int, y: int, button: str = "left", double: bool = False):
    if not PYWIN32_AVAILABLE:
        raise AutomationError("pywin32 not available for Win32 click fallback")
    win32api.SetCursorPos((int(x), int(y)))
    down, up = (
        (win32con.MOUSEEVENTF_RIGHTDOWN, win32con.MOUSEEVENTF_RIGHTUP)
        if button == "right"
        else (win32con.MOUSEEVENTF_LEFTDOWN, win32con.MOUSEEVENTF_LEFTUP)
    )
    clicks = 2 if double else 1
    for _ in range(clicks):
        win32api.mouse_event(down, 0, 0, 0, 0)
        win32api.mouse_event(up, 0, 0, 0, 0)
        time.sleep(0.03)


def _win32_send_char(ch: str):
    """Simulate a single character via SendInput (keyboard, unicode)."""
    KEYEVENTF_UNICODE = 0x0004
    KEYEVENTF_KEYUP = 0x0002
    INPUT_KEYBOARD = 1

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ("wVk", wintypes.WORD),
            ("wScan", wintypes.WORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
        ]

    class INPUT(ctypes.Structure):
        class _I(ctypes.Union):
            _fields_ = [("ki", KEYBDINPUT)]

        _anonymous_ = ("_i",)
        _fields_ = [("type", wintypes.DWORD), ("_i", _I)]

    def _send(flags):
        extra = ctypes.pointer(wintypes.ULONG(0))
        ki = KEYBDINPUT(0, ord(ch), flags, 0, extra)
        inp = INPUT(type=INPUT_KEYBOARD, ki=ki)
        ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))

    _send(KEYEVENTF_UNICODE)
    _send(KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
    time.sleep(0.01)


def _win32_type_string(text: str):
    for ch in text:
        _win32_send_char(ch)


def _win32_find_windows(title_regex: str):
    matches = []

    def handler(hwnd, _):
        if win32gui.IsWindowVisible(hwnd):
            title = win32gui.GetWindowText(hwnd)
            if title and re.search(title_regex, title, re.IGNORECASE):
                matches.append(hwnd)

    win32gui.EnumWindows(handler, None)
    return matches


# ---------------------------------------------------------------------------
# AutomationEngine
# ---------------------------------------------------------------------------

class AutomationEngine:
    def __init__(self):
        self.logs = []
        if not PYWINAUTO_AVAILABLE:
            self._log("WARNING: pywinauto is not installed — engine will run in degraded mode "
                       "(uiautomation / Win32 / mouse-keyboard only).")

    # -- logging -------------------------------------------------------

    def _log(self, message: str):
        self.logs.append(message)

    # -- window discovery ------------------------------------------------

    def list_windows(self):
        windows = []
        if PYWINAUTO_AVAILABLE:
            try:
                self._log("Listing windows via pywinauto UIA Desktop")
                for win in Desktop(backend="uia").windows():
                    title = win.window_text()
                    if title:
                        windows.append({
                            "title": title,
                            "class_name": win.class_name(),
                            "handle": win.handle,
                        })
                if windows:
                    return windows
            except Exception as e:
                self._log(f"pywinauto list_windows failed: {e}")

        if UIAUTOMATION_AVAILABLE:
            try:
                self._log("Listing windows via uiautomation fallback")
                root = auto.GetRootControl()
                for child in root.GetChildren():
                    if child.Name:
                        windows.append({
                            "title": child.Name,
                            "class_name": getattr(child, "ClassName", ""),
                            "handle": getattr(child, "NativeWindowHandle", None),
                        })
                if windows:
                    return windows
            except Exception as e:
                self._log(f"uiautomation list_windows failed: {e}")

        if PYWIN32_AVAILABLE:
            try:
                self._log("Listing windows via Win32 EnumWindows fallback")

                def handler(hwnd, acc):
                    if win32gui.IsWindowVisible(hwnd):
                        title = win32gui.GetWindowText(hwnd)
                        if title:
                            acc.append({
                                "title": title,
                                "class_name": win32gui.GetClassName(hwnd),
                                "handle": hwnd,
                            })

                win32gui.EnumWindows(handler, windows)
                return windows
            except Exception as e:
                self._log(f"Win32 list_windows failed: {e}")

        raise AutomationError("Unable to list windows with any available backend")

    def get_active_window(self):
        if PYWIN32_AVAILABLE:
            try:
                hwnd = win32gui.GetForegroundWindow()
                return {
                    "title": win32gui.GetWindowText(hwnd),
                    "class_name": win32gui.GetClassName(hwnd),
                    "handle": hwnd,
                }
            except Exception as e:
                self._log(f"get_active_window (Win32) failed: {e}")
        if PYWINAUTO_AVAILABLE:
            try:
                win = Desktop(backend="uia").get_active()
                return {"title": win.window_text(), "class_name": win.class_name(), "handle": win.handle}
            except Exception as e:
                self._log(f"get_active_window (pywinauto) failed: {e}")
        raise AutomationError("Unable to determine active window")

    # Window classes that are almost never the intended automation target,
    # but frequently contain incidental substring matches (e.g. a terminal
    # echoing the very search text back in its own title bar).
    _LOW_PRIORITY_CLASSES = {"ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS"}

    @staticmethod
    def _score_title_match(query: str, title: str):
        """Lower score = better match. None = no match at all.
        0 = exact, 1 = starts-with, 2 = whole-word match anywhere,
        3 = plain substring/regex match anywhere."""
        q = query.strip()
        if not q or not title:
            return None
        tl = title.lower()
        ql = q.lower()
        if tl == ql:
            return 0
        if tl.startswith(ql):
            return 1
        try:
            if re.search(r"\b" + re.escape(q) + r"\b", title, re.IGNORECASE):
                return 2
        except re.error:
            pass
        try:
            if re.search(q, title, re.IGNORECASE):
                return 3
        except re.error:
            pass
        return None

    def _best_window_match(self, query: str, windows: list):
        """Rank every enumerated window against the query and return the
        single best entry, deprioritizing terminal/console windows so a
        search term that merely appears in a shell's title bar (e.g. because
        it was echoed from a command-line argument) doesn't win over the
        actual target application."""
        best_score = None
        best_entry = None
        for entry in windows:
            title = entry.get("title") or ""
            score = self._score_title_match(query, title)
            if score is None:
                continue
            if entry.get("class_name") in self._LOW_PRIORITY_CLASSES:
                score += 10
            if best_score is None or score < best_score:
                best_score = score
                best_entry = entry
        return best_entry

    def _find_window(self, title_regex: str):
        """Locate a top-level window and return a pywinauto UIAWrapper for it
        whenever possible (richest control-level API), regardless of which
        backend actually located it.

        Rather than trusting any single backend's own regex semantics (which
        led to real bugs: pywinauto's title_re anchors at the START of the
        title, silently missing windows like "Channel - Workspace - Slack";
        and a naive re.search fallback could match an unrelated window, e.g.
        a terminal whose title happens to echo the search text), we enumerate
        every window once and rank the matches ourselves.
        """
        self._log(f"Searching window: '{title_regex}'")

        try:
            all_windows = self.list_windows()
        except Exception as e:
            self._log(f"Window enumeration failed: {e}")
            all_windows = []

        best = self._best_window_match(title_regex, all_windows)
        if best is not None:
            title = best.get("title")
            hwnd = best.get("handle")
            self._log(f"Best match: '{title}' (hwnd={hwnd})")
            if PYWINAUTO_AVAILABLE:
                try:
                    if hwnd:
                        app = Application(backend="uia").connect(handle=hwnd)
                        return app.window(handle=hwnd)
                    win = Desktop(backend="uia").window(title=title)
                    win.wait("exists", timeout=5)
                    return win
                except Exception as e:
                    self._log(f"Connecting to matched window via pywinauto failed: {e}")
            if hwnd:
                return _Win32WindowAdapter(hwnd, title)

        # Last-resort: let pywinauto try its own regex search directly, in
        # case our enumeration missed the window for some reason (e.g. a
        # UIA-restricted/elevated process that only pywinauto's own lookup
        # path can see).
        if PYWINAUTO_AVAILABLE:
            try:
                win = Desktop(backend="uia").window(title_re=title_regex)
                win.wait("exists", timeout=5)
                self._log(f"Found window via pywinauto UIA regex fallback: '{win.window_text()}'")
                return win
            except Exception as e:
                self._log(f"pywinauto window regex search failed: {e}")

        raise AutomationError(f"Window not found: '{title_regex}'")

    def connect_to_window(self, title_regex: str):
        return self._find_window(title_regex)

    def connect_by_process(self, process_name: str):
        self._log(f"Connecting by process name: '{process_name}'")
        if PYWINAUTO_AVAILABLE:
            try:
                app = Application(backend="uia").connect(path=process_name)
                win = app.top_window()
                self._log(f"Connected to process '{process_name}' via pywinauto")
                return win
            except Exception as e:
                self._log(f"pywinauto connect_by_process failed: {e}")
        if PYWIN32_AVAILABLE:
            try:
                target_hwnd = None

                def handler(hwnd, _):
                    nonlocal target_hwnd
                    if not win32gui.IsWindowVisible(hwnd):
                        return
                    try:
                        _, pid = win32process.GetWindowThreadProcessId(hwnd)
                        import psutil
                        proc = psutil.Process(pid)
                        if process_name.lower() in proc.name().lower():
                            target_hwnd = hwnd
                    except Exception:
                        pass

                win32gui.EnumWindows(handler, None)
                if target_hwnd:
                    title = win32gui.GetWindowText(target_hwnd)
                    self._log(f"Connected to process '{process_name}' via Win32 (hwnd={target_hwnd})")
                    if PYWINAUTO_AVAILABLE:
                        app = Application(backend="uia").connect(handle=target_hwnd)
                        return app.window(handle=target_hwnd)
                    return _Win32WindowAdapter(target_hwnd, title)
            except Exception as e:
                self._log(f"Win32 connect_by_process failed: {e}")
        raise AutomationError(f"Could not connect to process: '{process_name}'")

    # -- window manipulation ------------------------------------------------

    def _hwnd_of(self, win):
        hwnd = getattr(win, "handle", None)
        if not hwnd:
            raise AutomationError("Could not resolve a window handle for this control.")
        return hwnd

    def move_window(self, win, x: int, y: int):
        if not PYWIN32_AVAILABLE:
            raise AutomationError("pywin32 not available for window move")
        hwnd = self._hwnd_of(win)
        rect = win32gui.GetWindowRect(hwnd)
        width, height = rect[2] - rect[0], rect[3] - rect[1]
        win32gui.MoveWindow(hwnd, int(x), int(y), width, height, True)
        self._log(f"Moved window (hwnd={hwnd}) to ({x}, {y})")
        return {"x": int(x), "y": int(y), "width": width, "height": height}

    def resize_window(self, win, width: int, height: int):
        if not PYWIN32_AVAILABLE:
            raise AutomationError("pywin32 not available for window resize")
        hwnd = self._hwnd_of(win)
        rect = win32gui.GetWindowRect(hwnd)
        win32gui.MoveWindow(hwnd, rect[0], rect[1], int(width), int(height), True)
        self._log(f"Resized window (hwnd={hwnd}) to {width}x{height}")
        return {"x": rect[0], "y": rect[1], "width": int(width), "height": int(height)}

    def set_window_state(self, win, state: str):
        if not PYWIN32_AVAILABLE:
            raise AutomationError("pywin32 not available for window state change")
        hwnd = self._hwnd_of(win)
        cmd_map = {
            "minimize": win32con.SW_MINIMIZE,
            "maximize": win32con.SW_MAXIMIZE,
            "restore": win32con.SW_RESTORE,
        }
        cmd = cmd_map.get(state)
        if cmd is None:
            raise AutomationError(f"Unknown window state '{state}' (expected minimize/maximize/restore)")
        win32gui.ShowWindow(hwnd, cmd)
        self._log(f"Set window (hwnd={hwnd}) state to '{state}'")
        return {"state": state}

    def close_window(self, win):
        if not PYWIN32_AVAILABLE:
            raise AutomationError("pywin32 not available for window close")
        hwnd = self._hwnd_of(win)
        win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
        self._log(f"Sent WM_CLOSE to window (hwnd={hwnd})")
        return {"closed": True}

    def snap_window(self, win, position: str):
        """position: left | right | maximize | top-left | top-right | bottom-left | bottom-right"""
        if not PYWIN32_AVAILABLE:
            raise AutomationError("pywin32 not available for window snap")
        hwnd = self._hwnd_of(win)
        monitor = win32api.MonitorFromWindow(hwnd, win32con.MONITOR_DEFAULTTONEAREST)
        info = win32api.GetMonitorInfo(monitor)
        left, top, right, bottom = info["Work"]  # excludes taskbar
        full_w, full_h = right - left, bottom - top
        half_w, half_h = full_w // 2, full_h // 2

        if position == "maximize":
            win32gui.ShowWindow(hwnd, win32con.SW_MAXIMIZE)
            self._log(f"Snapped window (hwnd={hwnd}) to maximize")
            return {"position": position}

        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        rects = {
            "left": (left, top, half_w, full_h),
            "right": (left + half_w, top, full_w - half_w, full_h),
            "top-left": (left, top, half_w, half_h),
            "top-right": (left + half_w, top, full_w - half_w, half_h),
            "bottom-left": (left, top + half_h, half_w, full_h - half_h),
            "bottom-right": (left + half_w, top + half_h, full_w - half_w, full_h - half_h),
        }
        target = rects.get(position)
        if target is None:
            raise AutomationError(f"Unknown snap position '{position}' (expected left/right/maximize/top-left/top-right/bottom-left/bottom-right)")
        win32gui.MoveWindow(hwnd, *target, True)
        self._log(f"Snapped window (hwnd={hwnd}) to '{position}'")
        return {"position": position, "rect": target}

    def move_to_monitor(self, win, monitor_index: int):
        if not PYWIN32_AVAILABLE:
            raise AutomationError("pywin32 not available for monitor move")
        hwnd = self._hwnd_of(win)
        monitors = win32api.EnumDisplayMonitors()
        if monitor_index < 0 or monitor_index >= len(monitors):
            raise AutomationError(f"Monitor index {monitor_index} out of range (0-{len(monitors) - 1})")
        info = win32api.GetMonitorInfo(monitors[monitor_index][0])
        left, top, right, bottom = info["Work"]
        rect = win32gui.GetWindowRect(hwnd)
        width = min(rect[2] - rect[0], right - left)
        height = min(rect[3] - rect[1], bottom - top)
        win32gui.MoveWindow(hwnd, left, top, width, height, True)
        self._log(f"Moved window (hwnd={hwnd}) to monitor {monitor_index}")
        return {"monitor_index": monitor_index, "x": left, "y": top, "width": width, "height": height}

    def list_monitors(self):
        if not PYWIN32_AVAILABLE:
            raise AutomationError("pywin32 not available to list monitors")
        monitors = []
        for i, entry in enumerate(win32api.EnumDisplayMonitors()):
            info = win32api.GetMonitorInfo(entry[0])
            monitors.append({
                "index": i,
                "device": info.get("Device"),
                "is_primary": bool(info.get("Flags", 0) & 1),
                "work_area": info.get("Work"),
                "monitor_area": info.get("Monitor"),
            })
        return monitors

    # -- control discovery ------------------------------------------------

    def list_controls(self, win, max_controls: int = 400):
        """Dumps descendant controls, filtered and capped so the result stays
        small enough to round-trip through the chat API even on huge
        Chromium/Electron accessibility trees (e.g. Slack, Teams).

        - Skips elements with no name AND no automation id (pure layout/
          container noise — rarely what you want to click anyway).
        - Caps the total at max_controls, prioritizing named/interactive
          elements over unnamed ones so the truncation doesn't just chop off
          whatever pywinauto happened to enumerate first.
        """
        self._log("Dumping descendant controls")
        try:
            named: list = []
            unnamed: list = []
            for ctrl in win.descendants():
                text = (ctrl.window_text() or "").strip()
                auto_id = ctrl.element_info.automation_id or ""
                if not text and not auto_id:
                    continue  # unlabeled layout/container noise
                entry = {
                    "text": text,
                    "control_type": ctrl.element_info.control_type,
                    "auto_id": auto_id,
                    "class_name": ctrl.element_info.class_name,
                }
                (named if text else unnamed).append(entry)

            controls = named + unnamed
            truncated = len(controls) > max_controls
            controls = controls[:max_controls]
            if truncated:
                self._log(f"list_controls truncated to {max_controls} (had more) — prefer typing a filter/search query first to narrow the visible list before dumping again")
            return controls
        except Exception as e:
            self._log(f"list_controls failed: {e}")
            raise AutomationError(f"Unable to list controls: {e}")

    def find_control(self, win, name=None, auto_id=None, control_type=None, class_name=None):
        """Smart control search. Tries, in order:
        1. AutomationId  2. Name  3. ControlType  4. ClassName
        5. Partial text match  6. Descendant deep search
        """
        attempts = []
        if auto_id:
            attempts.append(("AutomationId", {"auto_id": auto_id}))
        if name:
            attempts.append(("Name", {"title": name}))
        if control_type:
            attempts.append(("ControlType", {"control_type": control_type}))
        if class_name:
            attempts.append(("ClassName", {"class_name": class_name}))

        for label, criteria in attempts:
            self._log(f"Searching control via {label}: {criteria}")
            try:
                ctrl = win.child_window(**criteria)
                ctrl.wait("exists", timeout=3)
                self._log(f"{label} search succeeded")
                return ctrl
            except Exception as e:
                self._log(f"{label} search failed: {e}")

        # Combined criteria (all given filters at once) — often more precise
        combined = {}
        if auto_id:
            combined["auto_id"] = auto_id
        if name:
            combined["title"] = name
        if control_type:
            combined["control_type"] = control_type
        if class_name:
            combined["class_name"] = class_name
        if len(combined) > 1:
            self._log(f"Searching control via combined criteria: {combined}")
            try:
                ctrl = win.child_window(**combined)
                ctrl.wait("exists", timeout=3)
                self._log("Combined criteria search succeeded")
                return ctrl
            except Exception as e:
                self._log(f"Combined criteria search failed: {e}")

        # Partial text match over descendants
        if name:
            self._log(f"Trying partial text match for '{name}' over descendants")
            try:
                best = None
                for d in win.descendants():
                    text = (d.window_text() or "").strip()
                    if not text:
                        continue
                    if name.lower() == text.lower():
                        return d
                    if name.lower() in text.lower() and best is None:
                        best = d
                if best is not None:
                    self._log("Partial text match found")
                    return best
            except Exception as e:
                self._log(f"Partial text/descendant search failed: {e}")

        # No name was given at all (e.g. only control_type/class_name), so every
        # attempt above that hit multiple matches was rejected as ambiguous
        # rather than actually "not found". Scan descendants ourselves and, if
        # there's exactly one visible candidate, just use it — otherwise raise
        # an error that lists the real candidate names so the caller can retry
        # with a specific controlText/itemName instead of guessing blindly.
        if not name and (control_type or class_name):
            self._log("No name given — scanning descendants for control_type/class_name candidates")
            try:
                candidates = []
                for d in win.descendants():
                    if control_type and d.element_info.control_type != control_type:
                        continue
                    if class_name and class_name.lower() not in (d.element_info.class_name or "").lower():
                        continue
                    candidates.append(d)

                if len(candidates) == 1:
                    self._log("Exactly one control_type/class_name candidate — using it")
                    return candidates[0]

                if len(candidates) > 1:
                    named = [(d.window_text() or "").strip() for d in candidates]
                    named = [t for t in named if t]
                    preview = ", ".join(repr(t) for t in named[:15])
                    raise AutomationError(
                        f"Ambiguous match: {len(candidates)} controls found for "
                        f"control_type={control_type!r} class_name={class_name!r} with no name/controlText "
                        f"to disambiguate. Candidate names include: {preview}. "
                        f"Retry with controlText (or itemName for selectItem) set to the exact name of the one you want."
                    )
            except AutomationError:
                raise
            except Exception as e:
                self._log(f"Descendant scan for control_type/class_name failed: {e}")

        raise AutomationError(
            f"No control found for name={name!r} auto_id={auto_id!r} "
            f"control_type={control_type!r} class_name={class_name!r}"
        )

    # -- click / focus / type ------------------------------------------------

    def click(self, ctrl, click_type: str = "left"):
        """click_type: 'left' | 'double' | 'right'"""
        method = None

        # 1. InvokePattern (only meaningful for a plain left click)
        if click_type == "left":
            try:
                self._log("Click method: InvokePattern")
                ctrl.invoke()
                method = "InvokePattern"
            except Exception as e:
                self._log(f"InvokePattern failed: {e}")

        # 2. SelectionItemPattern
        if method is None and click_type == "left":
            try:
                self._log("Click method: SelectionItemPattern")
                ctrl.select()
                method = "SelectionItemPattern"
            except Exception as e:
                self._log(f"SelectionItemPattern failed: {e}")

        # 3. LegacyIAccessible.DoDefaultAction (via pywinauto's UIA COM bindings)
        if method is None and click_type == "left":
            try:
                self._log("Click method: LegacyIAccessible")
                self._legacy_do_default_action(ctrl)
                method = "LegacyIAccessible"
            except Exception as e:
                self._log(f"LegacyIAccessible failed: {e}")

        # 4. ClickInput (pywinauto synthetic mouse click on the control itself)
        if method is None:
            try:
                self._log("Click method: ClickInput")
                if click_type == "double":
                    ctrl.double_click_input()
                elif click_type == "right":
                    ctrl.right_click_input()
                else:
                    ctrl.click_input()
                method = "ClickInput"
            except Exception as e:
                self._log(f"ClickInput failed: {e}")

        # 5. Win32 message-based click at the control's screen coordinates
        if method is None:
            try:
                self._log("Click method: Win32 mouse_event at control rect")
                rect = ctrl.rectangle()
                x = (rect.left + rect.right) // 2
                y = (rect.top + rect.bottom) // 2
                _win32_click_at(x, y, button=("right" if click_type == "right" else "left"),
                                 double=(click_type == "double"))
                method = "Win32MouseEvent"
            except Exception as e:
                self._log(f"Win32 mouse_event click failed: {e}")

        # 6. Absolute last resort: raw mouse click, no control context needed
        if method is None:
            try:
                self._log("Click method: raw mouse click fallback")
                rect = ctrl.rectangle()
                x = (rect.left + rect.right) // 2
                y = (rect.top + rect.bottom) // 2
                win32api.SetCursorPos((x, y)) if PYWIN32_AVAILABLE else None
                _win32_click_at(x, y)
                method = "MouseFallback"
            except Exception as e:
                self._log(f"Raw mouse fallback failed: {e}")

        if method is None:
            raise AutomationError("All click strategies failed")

        self._log(f"Success via {method}")
        return method

    def double_click(self, ctrl):
        return self.click(ctrl, click_type="double")

    def right_click(self, ctrl):
        return self.click(ctrl, click_type="right")

    def _legacy_do_default_action(self, ctrl):
        """Best-effort call into IUIAutomationLegacyIAccessiblePattern.DoDefaultAction()
        using pywinauto's own comtypes/UIA bindings. Wrapped by the caller so any
        failure (missing pattern, older pywinauto internals, etc.) simply falls
        through to the next strategy — it never crashes the engine."""
        from pywinauto.uia_defines import IUIA
        uia = IUIA()
        elem = ctrl.element_info.element
        pattern = elem.GetCurrentPattern(uia.pattern_ids.UIA_LegacyIAccessiblePatternId)
        if not pattern:
            raise AutomationError("LegacyIAccessible pattern not supported by this control")
        legacy = pattern.QueryInterface(uia.IUIA().IUIAutomationLegacyIAccessiblePattern)
        legacy.DoDefaultAction()

    def set_focus(self, ctrl):
        try:
            self._log("Setting focus via pywinauto set_focus()")
            ctrl.set_focus()
            return True
        except Exception as e:
            self._log(f"set_focus failed: {e}")
        try:
            self._log("Setting focus via click_input()")
            ctrl.click_input()
            return True
        except Exception as e:
            self._log(f"Focus-by-click fallback failed: {e}")
            raise AutomationError(f"Unable to set focus: {e}")

    def type_text(self, ctrl, text: str):
        method = None

        # 1. ValuePattern (direct, no keystrokes — fastest & most reliable)
        try:
            self._log("Type method: ValuePattern")
            from pywinauto.uia_defines import IUIA
            uia = IUIA()
            elem = ctrl.element_info.element
            pattern = elem.GetCurrentPattern(uia.pattern_ids.UIA_ValuePatternId)
            if not pattern:
                raise AutomationError("ValuePattern not supported by this control")
            value_pattern = pattern.QueryInterface(uia.IUIA().IUIAutomationValuePattern)
            value_pattern.SetValue(text)
            method = "ValuePattern"
        except Exception as e:
            self._log(f"ValuePattern failed: {e}")

        # 2. pywinauto set_edit_text()
        if method is None:
            try:
                self._log("Type method: set_edit_text")
                ctrl.set_edit_text(text)
                method = "set_edit_text"
            except Exception as e:
                self._log(f"set_edit_text failed: {e}")

        # 3. pywinauto type_keys() (click to focus first)
        if method is None:
            try:
                self._log("Type method: type_keys")
                try:
                    ctrl.click_input()
                except Exception:
                    pass
                ctrl.type_keys(text, with_spaces=True, with_tabs=True, with_newlines=True)
                method = "type_keys"
            except Exception as e:
                self._log(f"type_keys failed: {e}")

        # 4. uiautomation SendKeys
        if method is None and UIAUTOMATION_AVAILABLE:
            try:
                self._log("Type method: uiautomation SendKeys")
                ctrl.set_focus()
                escaped = text.replace("{", "{{}").replace("}", "{}}")
                auto.SendKeys(escaped)
                method = "uiautomation.SendKeys"
            except Exception as e:
                self._log(f"uiautomation SendKeys failed: {e}")

        # 5. Raw Win32 keyboard simulation (SendInput, unicode, char by char)
        if method is None:
            try:
                self._log("Type method: Win32 keyboard simulation")
                try:
                    ctrl.set_focus()
                except Exception:
                    ctrl.click_input()
                _win32_type_string(text)
                method = "Win32Keyboard"
            except Exception as e:
                self._log(f"Win32 keyboard simulation failed: {e}")

        if method is None:
            raise AutomationError("All typing strategies failed")

        self._log(f"Success via {method}")
        return method

    def press_key(self, key: str, ctrl=None):
        """Press a single key / combo (e.g. 'enter', '^c', '%{F4}' in
        pywinauto send-keys syntax) on a control if given, else globally."""
        target = ctrl if ctrl is not None else None
        try:
            self._log(f"press_key via pywinauto send_keys: '{key}'")
            if target is not None:
                target.type_keys(key)
            else:
                from pywinauto.keyboard import send_keys
                send_keys(key)
            return True
        except Exception as e:
            self._log(f"pywinauto press_key failed: {e}")
        if UIAUTOMATION_AVAILABLE:
            try:
                self._log(f"press_key via uiautomation SendKeys: '{key}'")
                auto.SendKeys(key)
                return True
            except Exception as e:
                self._log(f"uiautomation press_key failed: {e}")
        raise AutomationError(f"Unable to press key: '{key}'")

    # -- selection / expand / collapse / scroll ------------------------------

    def select_item(self, ctrl, name: str = None):
        try:
            self._log("select_item via SelectionItemPattern (.select())")
            if name is not None and hasattr(ctrl, "select"):
                ctrl.select(name)
            else:
                ctrl.select()
            return "SelectionItemPattern"
        except Exception as e:
            self._log(f"select_item via pattern failed: {e}")
        try:
            self._log("select_item fallback via click")
            return self.click(ctrl)
        except Exception as e:
            self._log(f"select_item click fallback failed: {e}")
            raise AutomationError(f"Unable to select item: {e}")

    def expand(self, ctrl):
        try:
            self._log("expand via ExpandCollapsePattern (.expand())")
            ctrl.expand()
            return "ExpandCollapsePattern"
        except Exception as e:
            self._log(f"expand failed: {e}")
        try:
            self._log("expand fallback via click")
            return self.click(ctrl)
        except Exception as e:
            raise AutomationError(f"Unable to expand control: {e}")

    def collapse(self, ctrl):
        try:
            self._log("collapse via ExpandCollapsePattern (.collapse())")
            ctrl.collapse()
            return "ExpandCollapsePattern"
        except Exception as e:
            self._log(f"collapse failed: {e}")
        try:
            self._log("collapse fallback via click")
            return self.click(ctrl)
        except Exception as e:
            raise AutomationError(f"Unable to collapse control: {e}")

    def scroll(self, ctrl, direction: str = "down", amount: int = 3):
        try:
            self._log(f"scroll via pywinauto .scroll({direction})")
            ctrl.scroll(direction, "line", amount)
            return "ScrollPattern"
        except Exception as e:
            self._log(f"scroll via pattern failed: {e}")
        try:
            self._log("scroll fallback via mouse wheel")
            rect = ctrl.rectangle()
            x = (rect.left + rect.right) // 2
            y = (rect.top + rect.bottom) // 2
            if PYWIN32_AVAILABLE:
                win32api.SetCursorPos((x, y))
                delta = 120 * amount * (1 if direction == "up" else -1)
                win32api.mouse_event(win32con.MOUSEEVENTF_WHEEL, x, y, delta, 0)
                return "MouseWheelFallback"
        except Exception as e:
            self._log(f"mouse wheel scroll fallback failed: {e}")
        raise AutomationError("Unable to scroll control")

    # -- verification ------------------------------------------------

    def verify_click(self, ctrl, before_state: dict = None):
        """Best-effort verification. Returns True/False when it can determine
        an outcome, None when it genuinely cannot tell (not a failure)."""
        try:
            try:
                if ctrl.has_keyboard_focus():
                    return True
            except Exception:
                pass
            try:
                if ctrl.is_selected():
                    return True
            except Exception:
                pass
            try:
                if before_state and ctrl.get_toggle_state() != before_state.get("toggle_state"):
                    return True
            except Exception:
                pass
            return None
        except Exception:
            return None

    def verify_type(self, ctrl, expected_text: str):
        try:
            current = None
            try:
                current = ctrl.get_value()
            except Exception:
                pass
            if current is None:
                try:
                    current = ctrl.window_text()
                except Exception:
                    current = None
            if current is None:
                return None
            return expected_text.strip() in current
        except Exception:
            return None

    def snapshot(self, ctrl):
        """Small state snapshot used for before/after verification."""
        state = {}
        try:
            state["focused"] = ctrl.has_keyboard_focus()
        except Exception:
            pass
        try:
            state["selected"] = ctrl.is_selected()
        except Exception:
            pass
        try:
            state["toggle_state"] = ctrl.get_toggle_state()
        except Exception:
            pass
        return state


class _Win32WindowAdapter:
    """Minimal stand-in used only if both pywinauto AND uiautomation-to-pywinauto
    handoff are unavailable, so window identity can still be reported. Control
    level actions are not supported through this adapter — it exists purely so
    list_windows / get_active_window style calls degrade gracefully instead of
    crashing when pywinauto itself is missing."""

    def __init__(self, hwnd, title):
        self.handle = hwnd
        self._title = title

    def window_text(self):
        return self._title

    def class_name(self):
        return win32gui.GetClassName(self.handle) if PYWIN32_AVAILABLE else ""
