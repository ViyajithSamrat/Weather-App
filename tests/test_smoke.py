"""
API smoke tests — run against a live Next.js server on localhost:3000.
These verify the HTTP surface of the app, not browser behaviour.
"""

import pytest
import requests

BASE_URL = "http://localhost:3000"


class TestHomepage:
    def test_returns_200(self, http):
        resp = http.get(BASE_URL)
        assert resp.status_code == 200

    def test_content_type_is_html(self, http):
        resp = http.get(BASE_URL)
        assert "text/html" in resp.headers.get("content-type", "")

    def test_html_contains_app_name(self, http):
        resp = http.get(BASE_URL)
        assert "Vertex" in resp.text


class TestGeocodeApi:
    def test_short_query_returns_empty_array(self, http):
        """Queries under 3 chars must return [] with status 200."""
        resp = http.get(f"{BASE_URL}/api/geocode?q=Lo")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_missing_query_param_returns_empty_array(self, http):
        """No q param must return [] with status 200."""
        resp = http.get(f"{BASE_URL}/api/geocode")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_valid_query_returns_json(self, http):
        """A valid query must return a JSON response (array or error object)."""
        resp = http.get(f"{BASE_URL}/api/geocode?q=London")
        # 200 = success, 500 = no API key configured, 502 = upstream failed
        assert resp.status_code in (200, 500, 502)
        body = resp.json()
        assert isinstance(body, (list, dict))

    def test_empty_string_query_returns_empty_array(self, http):
        """Empty q value must return []."""
        resp = http.get(f"{BASE_URL}/api/geocode?q=")
        assert resp.status_code == 200
        assert resp.json() == []


class TestWeatherTileApi:
    def test_invalid_layer_returns_400(self, http):
        resp = http.get(f"{BASE_URL}/api/weather/bad_layer/1/1/1")
        assert resp.status_code == 400
        body = resp.json()
        assert "error" in body

    def test_valid_layer_returns_200_or_500(self, http):
        """Valid layer → tile fetch attempted; 200 with image or 500 if no API key."""
        resp = requests.get(
            f"{BASE_URL}/api/weather/clouds_new/3/4/5",
            headers={"Accept": "*/*"},
        )
        assert resp.status_code in (200, 500)
