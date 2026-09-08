"""Offline QR generation and independent OpenCV decode check. No network access."""
from pathlib import Path
import json
import qrcode
import cv2

ROOT = Path(__file__).resolve().parent
DESTINATIONS = {
    "rosser-gallery": "https://rossergallery.com/qr",
    "rt-solutions": "https://rt.solutions/contact",
}

if __name__ == "__main__":
    checks = []
    for brand, url in DESTINATIONS.items():
        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=12, border=4)
        qr.add_data(url)
        qr.make(fit=True)
        path = ROOT / f"{brand}-qr.png"
        qr.make_image(fill_color="black", back_color="white").save(path)
        decoded, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.imread(str(path)))
        if decoded != url:
            raise RuntimeError(f"Independent QR decode failed for {brand}")
        checks.append({"brand": brand, "file": path.name, "destination": url, "independentDecoder": "OpenCV QRCodeDetector", "verified": True})
    print(json.dumps({"correlationId": "first-party-share-cards-20260908", "checks": checks}, indent=2))
