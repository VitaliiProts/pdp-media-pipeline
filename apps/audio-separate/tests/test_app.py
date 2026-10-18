from conftest import BUCKET
from fastapi.testclient import TestClient

from audio_separate.app import AppState, create_app

SEGMENTS = [
    {"id": "1", "speaker": "A", "start": 1.0, "end": 2.0, "text": "hello there"},
    {"id": "2", "speaker": "B", "start": 2.0, "end": 3.0, "text": "general kenobi"},
]
ANALYZE = {
    "vocals": "results/j/dub/vocals.flac",
    "segments": SEGMENTS,
    "output": "results/j/dub/analysis.json",
}
SEPARATE = {
    "input": "results/j/dub/audio.flac",
    "vocals": "results/j/dub/vocals.flac",
    "background": "results/j/dub/background.flac",
}


def test_separates_into_voice_and_background_once(setup):
    setup.put(SEPARATE["input"])

    for _ in range(2):
        res = setup.client.post("/v1/separate", json=SEPARATE)
        assert res.status_code == 200
        assert res.json() == {"vocals": SEPARATE["vocals"], "background": SEPARATE["background"]}
    assert setup.models.calls == ["separate"]
    assert setup.keys() == [SEPARATE["input"], SEPARATE["background"], SEPARATE["vocals"]]
    head = setup.s3.head_object(Bucket=BUCKET, Key=SEPARATE["vocals"])
    assert head["ContentType"] == "audio/flac"


def test_analyzes_words_speakers_and_missed_voice_and_stores_the_result(setup):
    setup.put(ANALYZE["vocals"])

    res = setup.client.post("/v1/analyze", json=ANALYZE)
    assert res.status_code == 200
    result = res.json()
    assert [w["word"] for w in result["segments"][0]["words"]] == ["hello", "there"]
    assert result["speakers"] == [
        {"id": "A", "gender": "male", "maleProbability": 0.9, "seconds": 1.0},
        {"id": "B", "gender": "female", "maleProbability": 0.2, "seconds": 1.0},
    ]
    assert result["unrecognized"] == [{"start": 7.0, "end": 8.0}]

    again = setup.client.post("/v1/analyze", json=ANALYZE)
    assert again.json() == result
    assert setup.models.calls == ["load_voice", "align"]
    assert ANALYZE["output"] in setup.keys()


def test_a_busy_pod_asks_to_come_back(setup):
    setup.state.busy = True
    res = setup.client.post("/v1/analyze", json=ANALYZE)
    assert res.status_code == 503
    assert res.headers["retry-after"] == "5"


def test_not_ready_until_the_models_are_loaded():
    client = TestClient(create_app(AppState()))
    assert client.get("/health/live").status_code == 200
    assert client.get("/health/ready").status_code == 503
    res = client.post("/v1/analyze", json=ANALYZE)
    assert res.status_code == 503
    assert "retry-after" in res.headers


def test_a_missing_input_is_a_client_error_and_frees_the_pod(setup):
    res = setup.client.post("/v1/analyze", json=ANALYZE)
    assert res.status_code == 404
    assert setup.state.busy is False


def test_rejects_a_malformed_request(setup):
    assert setup.client.post("/v1/separate", json={"input": ""}).status_code == 422
