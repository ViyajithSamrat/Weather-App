import time
import pytest
import requests

BASE_URL = "http://localhost:3000"


@pytest.fixture(scope="session", autouse=True)
def server_ready():
    """Block until the Next.js server responds (max 60 s)."""
    for attempt in range(30):
        try:
            resp = requests.get(BASE_URL, timeout=5)
            if resp.status_code < 500:
                return
        except requests.ConnectionError:
            pass
        print(f"Waiting for server… attempt {attempt + 1}/30")
        time.sleep(2)
    raise RuntimeError(f"Next.js server at {BASE_URL} not ready after 60 s")


@pytest.fixture(scope="session")
def http():
    """Shared requests.Session for all smoke tests."""
    session = requests.Session()
    session.headers.update({"Accept": "application/json"})
    return session
