#!/usr/bin/env python3
"""
Montager Desktop UI - Classic desktop interface using PyQt5.

Usage:
    python montager_gui.py
    
Logs are written to: ~/.montager/gui.log
"""

import logging
import sys
import threading
import traceback
from datetime import datetime
from pathlib import Path

# Setup logging before other imports
LOG_DIR = Path.home() / ".montager"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "gui.log"

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)
logger.info(f"=== Montager GUI started at {datetime.now().isoformat()} ===")

from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QLabel, QFileDialog, QProgressBar, QMessageBox, QFrame
)
from PyQt5.QtCore import Qt, pyqtSignal, QObject
from PyQt5.QtGui import QDragEnterEvent, QDropEvent, QFont

from montager import (
    detect_scene,
    detect_voicemap,
    generate_preview,
    render_montage,
)

logger.info("All imports successful")


class WorkerSignals(QObject):
    """Signals for thread communication."""
    status = pyqtSignal(str)
    finished = pyqtSignal(str)
    error = pyqtSignal(str)


class DropZone(QFrame):
    """Drag and drop area for video files."""
    
    fileDropped = pyqtSignal(Path)
    
    def __init__(self):
        super().__init__()
        self.setAcceptDrops(True)
        self.setFrameStyle(QFrame.StyledPanel | QFrame.Sunken)
        self.setMinimumHeight(100)
        self.setStyleSheet("""
            DropZone {
                border: 2px dashed #888;
                border-radius: 8px;
                background: #f5f5f5;
            }
            DropZone:hover {
                border-color: #4a90d9;
                background: #e8f0fe;
            }
        """)
        
        layout = QVBoxLayout(self)
        layout.setAlignment(Qt.AlignCenter)
        
        self.label = QLabel("📁 Drop video file here\nor click Browse")
        self.label.setAlignment(Qt.AlignCenter)
        self.label.setStyleSheet("color: #666; font-size: 14px;")
        layout.addWidget(self.label)
    
    def dragEnterEvent(self, event: QDragEnterEvent):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
            self.setStyleSheet("""
                DropZone {
                    border: 2px solid #4a90d9;
                    border-radius: 8px;
                    background: #e8f0fe;
                }
            """)
    
    def dragLeaveEvent(self, event):
        self.setStyleSheet("""
            DropZone {
                border: 2px dashed #888;
                border-radius: 8px;
                background: #f5f5f5;
            }
        """)
    
    def dropEvent(self, event: QDropEvent):
        self.setStyleSheet("""
            DropZone {
                border: 2px dashed #888;
                border-radius: 8px;
                background: #f5f5f5;
            }
        """)
        
        urls = event.mimeData().urls()
        if urls:
            path = Path(urls[0].toLocalFile())
            if path.suffix.lower() in ('.mp4', '.mov', '.avi', '.mkv', '.webm'):
                self.fileDropped.emit(path)
    
    def setFile(self, path: Path):
        self.label.setText(f"📹 {path.name}")
        self.label.setStyleSheet("color: #2e7d32; font-size: 14px; font-weight: bold;")


class MontagerWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.video_path = None
        self.processing = False
        self.signals = WorkerSignals()
        
        self._setup_ui()
        self._connect_signals()
    
    def _setup_ui(self):
        self.setWindowTitle("Montager")
        self.setFixedSize(450, 280)
        
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(15)
        
        # Title
        title = QLabel("🎬 Montager")
        title.setFont(QFont("", 22, QFont.Bold))
        title.setAlignment(Qt.AlignCenter)
        layout.addWidget(title)
        
        # Drop zone
        self.drop_zone = DropZone()
        self.drop_zone.fileDropped.connect(self._set_video)
        layout.addWidget(self.drop_zone)
        
        # Browse button
        browse_btn = QPushButton("Browse...")
        browse_btn.clicked.connect(self._browse_file)
        layout.addWidget(browse_btn)
        
        # Action buttons
        btn_layout = QHBoxLayout()
        
        self.preview_btn = QPushButton("👁️ Preview")
        self.preview_btn.setEnabled(False)
        self.preview_btn.clicked.connect(self._preview)
        btn_layout.addWidget(self.preview_btn)
        
        self.render_btn = QPushButton("🎬 Render")
        self.render_btn.setEnabled(False)
        self.render_btn.clicked.connect(self._render)
        btn_layout.addWidget(self.render_btn)
        
        layout.addLayout(btn_layout)
        
        # Status
        self.status_label = QLabel("Select a video file to begin")
        self.status_label.setAlignment(Qt.AlignCenter)
        self.status_label.setStyleSheet("color: #666;")
        layout.addWidget(self.status_label)
        
        # Progress bar
        self.progress = QProgressBar()
        self.progress.setRange(0, 0)  # Indeterminate
        self.progress.setVisible(False)
        layout.addWidget(self.progress)
    
    def _connect_signals(self):
        self.signals.status.connect(self._on_status)
        self.signals.finished.connect(self._on_finished)
        self.signals.error.connect(self._on_error)
    
    def _browse_file(self):
        if self.processing:
            return
        
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Select Video File",
            "",
            "Video Files (*.mp4 *.mov *.avi *.mkv *.webm);;All Files (*)"
        )
        if path:
            self._set_video(Path(path))
    
    def _set_video(self, path: Path):
        self.video_path = path
        self.drop_zone.setFile(path)
        self.preview_btn.setEnabled(True)
        self.render_btn.setEnabled(True)
        self.status_label.setText(f"Ready: {path.name}")
    
    def _set_processing(self, active: bool):
        self.processing = active
        self.preview_btn.setEnabled(not active)
        self.render_btn.setEnabled(not active)
        self.progress.setVisible(active)
    
    def _preview(self):
        if not self.video_path or self.processing:
            return
        
        logger.info(f"Starting preview for: {self.video_path}")
        
        def task():
            try:
                self.signals.status.emit("Detecting faces...")
                logger.info("Running detect_scene...")
                detect_scene(self.video_path)
                logger.info("detect_scene complete")
                
                self.signals.status.emit("Detecting speech...")
                logger.info("Running detect_voicemap...")
                detect_voicemap(self.video_path)
                logger.info("detect_voicemap complete")
                
                self.signals.status.emit("Generating preview...")
                logger.info("Running generate_preview...")
                preview_path = generate_preview(self.video_path)
                logger.info(f"Preview generated: {preview_path}")
                
                self.signals.finished.emit(f"Preview ready: {preview_path.name}")
            except Exception as e:
                logger.error(f"Preview failed: {e}")
                logger.error(traceback.format_exc())
                self.signals.error.emit(str(e))
        
        self._set_processing(True)
        threading.Thread(target=task, daemon=True).start()
    
    def _render(self):
        if not self.video_path or self.processing:
            return
        
        logger.info(f"Starting render for: {self.video_path}")
        
        def task():
            try:
                self.signals.status.emit("Detecting faces...")
                logger.info("Running detect_scene...")
                detect_scene(self.video_path)
                logger.info("detect_scene complete")
                
                self.signals.status.emit("Detecting speech...")
                logger.info("Running detect_voicemap...")
                detect_voicemap(self.video_path)
                logger.info("detect_voicemap complete")
                
                self.signals.status.emit("Rendering montage...")
                logger.info("Running render_montage...")
                output_path = render_montage(self.video_path)
                logger.info(f"Render complete: {output_path}")
                
                self.signals.finished.emit(f"Rendered: {output_path.name}")
            except Exception as e:
                logger.error(f"Render failed: {e}")
                logger.error(traceback.format_exc())
                self.signals.error.emit(str(e))
        
        self._set_processing(True)
        threading.Thread(target=task, daemon=True).start()
    
    def _on_status(self, message: str):
        logger.debug(f"Status: {message}")
        self.status_label.setText(message)
    
    def _on_finished(self, message: str):
        logger.info(f"Finished: {message}")
        self._set_processing(False)
        self.status_label.setText(message)
        QMessageBox.information(self, "Complete", message)
    
    def _on_error(self, error: str):
        logger.error(f"Error shown to user: {error}")
        self._set_processing(False)
        self.status_label.setText(f"Error: {error}")
        QMessageBox.critical(self, "Error", error)


def main():
    logger.info("Creating QApplication")
    app = QApplication(sys.argv)
    logger.info("Creating MontagerWindow")
    window = MontagerWindow()
    window.show()
    logger.info("Window shown, entering event loop")
    sys.exit(app.exec_())


if __name__ == '__main__':
    main()
