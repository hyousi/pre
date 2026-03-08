"""
Entry point for the packaged backend (PyInstaller).
Starts uvicorn programmatically on port 8765.
"""

import uvicorn

from main import app

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
