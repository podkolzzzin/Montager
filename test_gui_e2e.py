#!/usr/bin/env python3
"""
E2E tests for Montager GUI using pytest-qt.

Run with:
    pytest test_gui_e2e.py -v -s
"""

import pytest
import time
from pathlib import Path

from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtWidgets import QApplication, QMessageBox

from montager_gui import MontagerWindow


# Test video path
TEST_VIDEO = Path(__file__).parent / "C0023.MP4"


@pytest.fixture
def app(qtbot):
    """Create the application window."""
    window = MontagerWindow()
    qtbot.addWidget(window)
    window.show()
    return window


def test_window_starts(app):
    """Test that window opens successfully."""
    assert app.isVisible()
    assert app.windowTitle() == "Montager"
    assert app.preview_btn.isEnabled() == False
    assert app.render_btn.isEnabled() == False


def test_file_selection_enables_buttons(app, qtbot):
    """Test that selecting a file enables the buttons."""
    assert TEST_VIDEO.exists(), f"Test video not found: {TEST_VIDEO}"
    
    # Simulate file selection
    app._set_video(TEST_VIDEO)
    
    assert app.video_path == TEST_VIDEO
    assert app.preview_btn.isEnabled() == True
    assert app.render_btn.isEnabled() == True
    assert "C0023.MP4" in app.status_label.text()


def test_preview_generation(app, qtbot, monkeypatch):
    """Test full preview generation flow."""
    assert TEST_VIDEO.exists(), f"Test video not found: {TEST_VIDEO}"
    
    # Select video
    app._set_video(TEST_VIDEO)
    
    # Auto-close message boxes
    def auto_close_msgbox():
        for widget in QApplication.topLevelWidgets():
            if isinstance(widget, QMessageBox):
                widget.accept()
    
    timer = QTimer()
    timer.timeout.connect(auto_close_msgbox)
    timer.start(500)
    
    # Click preview button
    qtbot.mouseClick(app.preview_btn, Qt.LeftButton)
    
    # Wait for processing to complete (with timeout)
    max_wait = 300  # 5 minutes max
    start = time.time()
    
    while app.processing and (time.time() - start) < max_wait:
        qtbot.wait(1000)  # Wait 1 second
        print(f"  Status: {app.status_label.text()}")
    
    timer.stop()
    
    # Check result
    assert not app.processing, "Processing did not complete in time"
    
    status = app.status_label.text()
    print(f"Final status: {status}")
    
    if "Error" in status:
        pytest.fail(f"Preview failed: {status}")
    
    assert "Preview ready" in status or "preview" in status.lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
