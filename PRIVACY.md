# Privacy Policy

**Chat Exporter (local)**

This extension does not collect, transmit, store, or share any personal data.

## What it does

When you click a format button, the extension reads the conversation currently displayed in your
browser tab, converts it to the file format you chose, and saves it to your computer through
Firefox's own download prompt. PDFs are produced by Firefox's built-in print engine.

All of this happens on your device. Nothing is sent anywhere.

## Data collected

None.

- No analytics, telemetry, crash reporting, or usage statistics.
- No accounts, logins, or identifiers.
- No advertising or tracking of any kind.
- Conversation content is never transmitted off your device.

## Network access

The extension makes no network requests. It contains no remote code, no external scripts, no
web fonts, and no content delivery network references. This is verifiable in the source: searching
the extension files for `fetch`, `XMLHttpRequest`, or `sendBeacon` returns no results.

## Local storage

The extension uses Firefox's local storage for two purposes only:

1. Remembering your display preferences (paper theme, typeface, text size, and whether to scroll
   back through long threads).
2. Briefly passing a transcript to the print view. This entry is deleted as soon as the print
   page reads it.

Both remain on your device and are never transmitted.

## Permissions

| Permission | Why |
|---|---|
| Access to `chatgpt.com` and `chat.openai.com` | Read the conversation you are viewing so it can be exported. No other sites are matched. |
| `downloads` | Save the exported file you requested. |
| `storage` | Remember your preferences and pass the transcript to the print view. |

## Files you create

Exported files are saved wherever you choose. The extension has no access to them afterwards and
no ability to read files elsewhere on your computer.

## Source code

The complete, unminified source is included in the extension package and can be inspected in full.

## Changes

If this policy ever changes, the updated version will accompany the release that changes it.
