from __future__ import annotations

import threading
from typing import Optional

from pymongo import MongoClient


_client: Optional[MongoClient] = None
_client_uri: Optional[str] = None
_lock = threading.Lock()


def get_client(mongo_uri: str) -> MongoClient:
    global _client, _client_uri

    if _client is not None and _client_uri == mongo_uri:
        return _client

    with _lock:
        if _client is not None and _client_uri == mongo_uri:
            return _client

        # If URI changes between runs, close old client.
        if _client is not None:
            try:
                _client.close()
            except Exception:
                pass

        _client = MongoClient(mongo_uri)
        _client_uri = mongo_uri
        return _client


def get_collection(*, mongo_uri: str, db_name: str, collection_name: str):
    client = get_client(mongo_uri)
    return client[db_name][collection_name]


def close_client() -> None:
    global _client, _client_uri
    with _lock:
        if _client is not None:
            try:
                _client.close()
            finally:
                _client = None
                _client_uri = None
