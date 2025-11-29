
from flask import Flask, request, jsonify, render_template

from src.helper import (
    create_user_pdf,
    append_output_to_pdf,
    load_ml_dl_artifact,
    parse_symptoms_from_text,
)

from datetime import datetime, timedelta
from pathlib import Path
import base64
import hashlib
import hmac
import json
import uuid
import numpy as np

try:
    # Try to use the rich NLP pipeline and symptom vocabulary from `nlp.py`.
    # If any dependency inside `nlp.py` (like pandas/spacy/transformers) is
    # missing, we fall back to the lightweight parser in `src.helper`.
    from nlp import extract_symptoms_from_text as advanced_extract_symptoms, symptoms_list as ADV_SYMPTOM_VOCAB  # type: ignore
except Exception:
    advanced_extract_symptoms = None
    ADV_SYMPTOM_VOCAB = None

try:  # CNN model is optional but recommended
    from tensorflow.keras.models import load_model as load_keras_model  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    load_keras_model = None


app = Flask(__name__, template_folder="templates")

ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
USERS_FILE = DATA_DIR / "users.json"
REPORTS_FILE = DATA_DIR / "reports.json"
JWT_SECRET = "change-me-in-production"  # simple demo key
JWT_ALG = "HS256"
JWT_EXP_MINUTES = 60


def _load_users():
    if not USERS_FILE.exists():
        return []
    try:
        return json.loads(USERS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_users(users):
    USERS_FILE.write_text(json.dumps(users, indent=2), encoding="utf-8")


def _load_reports():
    if not REPORTS_FILE.exists():
        return []
    try:
        return json.loads(REPORTS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_reports(reports):
    REPORTS_FILE.write_text(json.dumps(reports, indent=2), encoding="utf-8")


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _verify_password(password: str, hashed: str) -> bool:
    return _hash_password(password) == hashed


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _create_jwt(payload: dict) -> str:
    header = {"alg": JWT_ALG, "typ": "JWT"}
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    sig = hmac.new(JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
    sig_b64 = _b64url_encode(sig)
    return f"{header_b64}.{payload_b64}.{sig_b64}"


def _verify_jwt(token: str):
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
        expected_sig = hmac.new(JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
        if not hmac.compare_digest(expected_sig, _b64url_decode(sig_b64)):
            return None
        payload = json.loads(_b64url_decode(payload_b64))
        exp = payload.get("exp")
        if exp is not None and datetime.utcnow().timestamp() > exp:
            return None
        return payload
    except Exception:
        return None


@app.after_request
def apply_cors(response):
    """
    Allow the React frontend (served from a different origin) to call this API.

    This is a simple, development-friendly CORS setup. For production you
    should restrict the allowed origin instead of using '*'. 
    """
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response

# Load classical ML model (.pkl)
ml_model = load_ml_dl_artifact("model_pipeline.pkl")

# Load CNN model (.h5) if possible
cnn_model = None
if load_keras_model is not None:
    try:
        cnn_model = load_keras_model("cnn_model.h5")
    except Exception:
        cnn_model = None


user_info = {}


def _vectorize_symptoms_for_cnn(extracted_symptoms):
    """
    Turn a list of symptom strings into a 1D-CNN input tensor.

    We build a simple one‑hot vector over the advanced symptom vocabulary
    defined in `nlp.py`, then reshape to (1, num_symptoms, 1) which matches
    the training setup in `prediction_models_project.py`.
    """
    if not extracted_symptoms or ADV_SYMPTOM_VOCAB is None:
        return None

    vocab = list(ADV_SYMPTOM_VOCAB)
    index_map = {s: i for i, s in enumerate(vocab)}

    vec = np.zeros(len(vocab), dtype="float32")
    for s in extracted_symptoms:
        idx = index_map.get(s)
        if idx is not None:
            vec[idx] = 1.0

    # Shape: (batch, timesteps, channels)
    return vec.reshape(1, len(vocab), 1)


def _run_cnn_prediction(extracted_symptoms):
    """
    Run the CNN model (if available) and return a structured result.

    Output format:
    {
        "class_index": int,
        "confidence": float,
        "disease": optional string label (if mapping CSV is available)
    }
    """
    if cnn_model is None or not extracted_symptoms:
        return None

    try:
        cnn_input = _vectorize_symptoms_for_cnn(extracted_symptoms)
        if cnn_input is None:
            return None
        probs = cnn_model.predict(cnn_input)
        probs = np.asarray(probs)[0]
        class_index = int(np.argmax(probs))
        confidence = float(probs[class_index])

        # Try to map index -> disease name using disease_mapping.csv if present
        disease_label = None
        try:
            import pandas as pd  # type: ignore

            mapping_df = pd.read_csv("disease_mapping.csv")
            match = mapping_df.loc[mapping_df["Encoded"] == class_index]
            if not match.empty:
                disease_label = str(match["Disease"].iloc[0])
        except Exception:
            disease_label = None

        result = {
            "class_index": class_index,
            "confidence": confidence,
        }
        if disease_label is not None:
            result["disease"] = disease_label
        return result
    except Exception:
        # If anything goes wrong we silently skip CNN and still return ML result
        return None


def _handle_chat_message(user_text: str) -> dict:
    """
    Core chatbot logic shared by both the legacy `/get` endpoint
    and the newer `/api/chatbot/message` endpoint.
    """
    global user_info

    # Simple conversational flow to collect basic demographics
    if not user_info.get("name"):
        user_info["name"] = user_text.strip()
        return {"answer": "Please enter your age:"}
    elif not user_info.get("age"):
        user_info["age"] = user_text.strip()
        return {"answer": "Please enter your gender:"}
    elif not user_info.get("gender"):
        user_info["gender"] = user_text.strip()

        create_user_pdf(user_info["name"], user_info["age"], user_info["gender"])
        return {
            "answer": "Now, please describe at least 3 of your symptoms with their intensity and duration."
        }

    # --- NLP extraction ---
    # Prefer the advanced NLP pipeline when its dependencies are available;
    # otherwise fall back to the lightweight rule-based extractor.
    if advanced_extract_symptoms is not None:
        symptoms = advanced_extract_symptoms(user_text)
    else:
        symptoms = parse_symptoms_from_text(user_text)
    if not symptoms:
        return {
            "answer": "I couldn't reliably extract symptoms from that. Please describe your symptoms with more detail."
        }

    # --- Classical ML prediction using the .pkl pipeline ---
    # We feed a single text sample created from the extracted symptoms.
    ml_input_text = ", ".join(symptoms)
    ml_pred_value = None
    try:
        ml_pred = ml_model.predict([ml_input_text])
        # Many sklearn models return a 1‑element array
        if hasattr(ml_pred, "__len__") and len(ml_pred) == 1:
            ml_pred_value = ml_pred[0]
        else:
            ml_pred_value = ml_pred
    except Exception:
        # Hide internal errors from the user; the CNN (if available)
        # and the extracted symptoms are still logged for the report.
        ml_pred_value = None

    # --- CNN prediction using the .h5 model (if available) ---
    cnn_result = _run_cnn_prediction(symptoms)

    # Build a structured report object for the frontend modal
    predictions_block = {}
    # Treat the main ML prediction as 100% confidence for display
    if ml_pred_value is not None:
        predictions_block[str(ml_pred_value)] = 100.0
    if cnn_result:
        disease_label = cnn_result.get(
            "disease", f"Class {cnn_result['class_index']} (CNN)"
        )
        predictions_block[disease_label] = round(
            float(cnn_result.get("confidence", 0.0)) * 100.0, 1
        )

    report = {
        "report_id": f"rep_{uuid.uuid4().hex[:8]}",
        "timestamp": datetime.utcnow().isoformat(),
        "patient": {
            "name": user_info.get("name", "Unknown"),
            "age": user_info.get("age", "N/A"),
            "gender": user_info.get("gender", "N/A"),
        },
        "symptoms": symptoms,
        "predictions": predictions_block,
        "recommended_doctors": [
            {
                "id": "featured-1",
                "name": "Dr. Ahmed Hassan",
                "specialty": "Cardiologist",
                "experience": "12+ years experience",
            },
            {
                "id": "featured-2",
                "name": "Dr. Fatima Ali",
                "specialty": "Pediatrician",
                "experience": "8+ years experience",
            },
        ],
        "notes": "This report is generated by AI and is not a medical diagnosis. Please consult a licensed physician.",
    }

    # Persist everything in the pseudo‑PDF report
    report_payload = {
        "symptoms": symptoms,
        "ml_prediction": None if ml_pred_value is None else str(ml_pred_value),
        "cnn_prediction": cnn_result,
        "structured_report": report,
    }
    append_output_to_pdf(report_payload)

    # Also persist in JSON reports store so the frontend can list them
    reports = _load_reports()
    reports.append(report)
    _save_reports(reports)

    # Compose a user‑friendly reply that summarises all models
    reply_parts = []
    if ml_pred_value is not None:
        reply_parts.append(
            f"Based on your symptoms, the ML model suggests: {ml_pred_value}."
        )
    else:
        reply_parts.append(
            "I recorded your symptoms, but the classical ML model could not "
            "produce a reliable prediction for this description."
        )
    if cnn_result and cnn_result.get("disease"):
        reply_parts.append(
            f"The CNN model also suggests: {cnn_result['disease']} "
            f"(confidence {cnn_result['confidence']:.2f})."
        )
    elif cnn_result:
        reply_parts.append(
            f"The CNN model's top prediction index is {cnn_result['class_index']} "
            f"(confidence {cnn_result['confidence']:.2f})."
        )

    final_reply = " ".join(reply_parts)

    # Frontend‑friendly JSON structure
    # Choose a primary prediction for the frontend, preferring CNN label,
    # then ML prediction, otherwise None.
    if cnn_result and cnn_result.get("disease"):
        primary_prediction = cnn_result["disease"]
    elif ml_pred_value is not None:
        primary_prediction = str(ml_pred_value)
    else:
        primary_prediction = None

    response_body = {
        "answer": final_reply,
        "symptoms": symptoms,
        "prediction": primary_prediction,
        "confidence": (cnn_result.get("confidence") if cnn_result else None),
        # Envelope for the React UI, which expects response.data.report
        "data": {"report": report},
    }

    return response_body


@app.route("/")
def index():
    return render_template("index.html")


# ---------- AUTH & USER MANAGEMENT ----------


@app.route("/api/auth/signup", methods=["POST", "OPTIONS"])
def api_signup():
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json() or {}
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    role = payload.get("role") or "patient"

    if not email or not password:
        return jsonify({"success": False, "message": "Email and password are required"}), 400

    users = _load_users()
    if any(u.get("email") == email for u in users):
        return jsonify({"success": False, "message": "User already exists"}), 409

    user_id = f"user_{uuid.uuid4().hex[:8]}"
    user = {
        "id": user_id,
        "fullName": payload.get("fullName") or payload.get("full_name") or "",
        "age": payload.get("age") or "",
        "gender": payload.get("gender") or "",
        "email": email,
        "role": role,
        "specialty": payload.get("specialty") or "",
        "mobile": payload.get("mobile") or "",
        "hospitalCode": payload.get("hospitalCode") or "",
        "password_hash": _hash_password(password),
        "created_at": datetime.utcnow().isoformat(),
    }
    users.append(user)
    _save_users(users)

    token_payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": (datetime.utcnow() + timedelta(minutes=JWT_EXP_MINUTES)).timestamp(),
    }
    token = _create_jwt(token_payload)

    public_user = {k: v for k, v in user.items() if k != "password_hash"}
    return jsonify({"success": True, "user": public_user, "token": token})


@app.route("/api/auth/login", methods=["POST", "OPTIONS"])
def api_login():
    if request.method == "OPTIONS":
        return ("", 204)

    payload = request.get_json() or {}
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    role = payload.get("role") or None

    users = _load_users()
    user = next((u for u in users if u.get("email") == email), None)
    if not user or not _verify_password(password, user.get("password_hash", "")):
        return jsonify({"success": False, "message": "Invalid credentials"}), 401

    if role and user.get("role") != role:
        return jsonify({"success": False, "message": "Role does not match this account"}), 401

    token_payload = {
        "sub": user["id"],
        "email": email,
        "role": user.get("role"),
        "exp": (datetime.utcnow() + timedelta(minutes=JWT_EXP_MINUTES)).timestamp(),
    }
    token = _create_jwt(token_payload)

    public_user = {k: v for k, v in user.items() if k != "password_hash"}
    return jsonify({"success": True, "user": public_user, "token": token})


@app.route("/api/auth/me", methods=["GET"])
def api_me():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return jsonify({"ok": False}), 401
    token = auth_header.split(" ", 1)[1]
    payload = _verify_jwt(token)
    if not payload:
        return jsonify({"ok": False}), 401
    return jsonify({"ok": True, "user": payload})


@app.route("/api/doctors", methods=["GET"])
def api_doctors():
    users = _load_users()
    doctors = [
        {
            "id": u["id"],
            "name": u.get("fullName") or u.get("full_name") or "Doctor",
            "specialty": u.get("specialty") or "General Practice",
            "experience": "—",
            "email": u.get("email"),
            "mobile": u.get("mobile") or "",
        }
        for u in users
        if u.get("role") == "doctor"
    ]
    return jsonify(doctors)


@app.route("/api/reports", methods=["GET"])
def api_reports():
    """
    Return all saved structured reports.
    In a real app you would filter by authenticated user; for now this
    returns the full list so the frontend can display them.
    """
    reports = _load_reports()
    return jsonify(reports)

# Legacy endpoint kept for compatibility
@app.route("/get", methods=["POST"])
def get_bot_response():
    data = request.get_json() or {}
    user_text = data.get("msg", "") or ""
    body = _handle_chat_message(user_text)
    return jsonify(body)


# Primary API endpoint used by the React frontend
@app.route("/api/chatbot/message", methods=["POST", "OPTIONS"])
def api_chatbot_message():
    # Handle CORS preflight
    if request.method == "OPTIONS":
        return ("", 204)

    data = request.get_json() or {}
    # Frontend sends { "message": "...", "session_id": "..." }
    user_text = data.get("message") or data.get("msg") or ""
    body = _handle_chat_message(user_text)
    return jsonify(body)


if __name__ == "__main__":
    app.run(debug=True)
