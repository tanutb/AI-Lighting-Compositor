import os
import sys
import webbrowser
import uvicorn
import multiprocessing
from threading import Timer

# Add current directory to path so main.py can be found
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import app

def open_browser(port):
    webbrowser.open(f"http://127.0.0.1:{port}")

if __name__ == "__main__":
    # Ensure multiprocessing works correctly on Windows when frozen
    multiprocessing.freeze_support()
    
    port = 8000
    
    # Schedule browser open (wait 1.5s for server to start)
    Timer(1.5, open_browser, args=[port]).start()
    
    # Run Server
    # workers=1 is important for PyInstaller to avoid complex multiprocessing issues
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
