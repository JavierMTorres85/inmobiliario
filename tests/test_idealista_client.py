from __future__ import annotations

import unittest

from scripts.idealista_client import IdealistaClient, SearchRequest


class FakeResponse:
    def __init__(self, status_code, payload, headers=None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.responses.pop(0)


class SearchRequestTests(unittest.TestCase):
    def test_payload_uses_api_names_and_custom_filters(self):
        request = SearchRequest(
            location_id="location-1",
            max_items=25,
            num_page=2,
            custom_filters={"bedrooms": 3},
        )
        self.assertEqual(
            request.to_payload(),
            {
                "operation": "sale",
                "propertyType": "homes",
                "locationId": "location-1",
                "maxItems": 25,
                "numPage": 2,
                "bedrooms": 3,
            },
        )

    def test_location_is_required(self):
        with self.assertRaises(ValueError):
            SearchRequest().to_payload()


class ClientTests(unittest.TestCase):
    def test_token_and_search_return_aggregate_total(self):
        session = FakeSession(
            [
                FakeResponse(200, {"access_token": "token", "expires_in": 3600}),
                FakeResponse(
                    200,
                    {
                        "actualPage": 1,
                        "itemsPerPage": 1,
                        "total": 123,
                        "totalPages": 123,
                        "elementList": [{"propertyCode": "abc"}],
                    },
                ),
            ]
        )
        client = IdealistaClient("key", "secret", session=session)
        response = client.search(SearchRequest(location_id="location-1", max_items=1))

        self.assertEqual(response.total, 123)
        self.assertEqual(response.elements[0]["propertyCode"], "abc")
        self.assertEqual(session.calls[1][0], "https://api.idealista.com/3.5/es/search")
        self.assertEqual(session.calls[1][1]["timeout"], 20.0)

    def test_retry_after_is_honoured(self):
        sleeps = []
        session = FakeSession(
            [
                FakeResponse(200, {"access_token": "token", "expires_in": 3600}),
                FakeResponse(429, {"message": "rate limited"}, {"Retry-After": "2"}),
                FakeResponse(200, {"total": 4, "totalPages": 1, "elementList": []}),
            ]
        )
        client = IdealistaClient("key", "secret", session=session, sleep=sleeps.append)
        response = client.search(SearchRequest(location_id="location-1"))

        self.assertEqual(response.total, 4)
        self.assertEqual(sleeps, [2.0])


if __name__ == "__main__":
    unittest.main()

