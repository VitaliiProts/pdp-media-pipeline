"""The examples in contract/ are what video-worker sends and parses
(apps/video-worker/src/dub/audio-separate/audio-separate.contract.spec.ts checks the other side)."""

import json
from pathlib import Path

import pytest

CONTRACT = Path(__file__).parent.parent / "contract"


def example(name: str) -> dict:
    return json.loads((CONTRACT / f"{name}.json").read_text())


@pytest.mark.parametrize("operation", ["separate", "analyze"])
def test_answers_the_requests_of_the_worker_as_the_worker_expects(setup, operation):
    request = example(f"{operation}.request")
    setup.put(request.get("input") or request["vocals"])

    res = setup.client.post(f"/v1/{operation}", json=request)

    assert res.status_code == 200
    assert res.json() == example(f"{operation}.response")
