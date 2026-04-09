"""Upload AAB to Google Play Internal Testing track."""
import sys
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

PACKAGE_NAME = "com.driversreward.app"
SERVICE_ACCOUNT_JSON = "play-service-account.json"
AAB_PATH = "android-app/app/build/outputs/bundle/release/app-release.aab"
TRACK = "internal"

credentials = service_account.Credentials.from_service_account_file(
    SERVICE_ACCOUNT_JSON,
    scopes=["https://www.googleapis.com/auth/androidpublisher"],
)

service = build("androidpublisher", "v3", credentials=credentials)

print("Creating edit...")
edit = service.edits().insert(body={}, packageName=PACKAGE_NAME).execute()
edit_id = edit["id"]
print(f"Edit ID: {edit_id}")

print(f"Uploading {AAB_PATH}...")
bundle = (
    service.edits()
    .bundles()
    .upload(
        packageName=PACKAGE_NAME,
        editId=edit_id,
        media_body=MediaFileUpload(AAB_PATH, mimetype="application/octet-stream"),
        media_mime_type="application/octet-stream",
    )
    .execute()
)
version_code = bundle["versionCode"]
print(f"Uploaded bundle version code: {version_code}")

print(f"Assigning to '{TRACK}' track...")
service.edits().tracks().update(
    packageName=PACKAGE_NAME,
    editId=edit_id,
    track=TRACK,
    body={
        "track": TRACK,
        "releases": [
            {
                "versionCodes": [str(version_code)],
                "status": "draft",
                "releaseNotes": [
                    {"language": "en-US", "text": "Initial internal test release v1.0"}
                ],
            }
        ],
    },
).execute()

print("Committing edit...")
service.edits().commit(packageName=PACKAGE_NAME, editId=edit_id).execute()
print(f"Successfully uploaded to {TRACK} track! Version code: {version_code}")
