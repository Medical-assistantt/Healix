import joblib

model = joblib.load("model_pipeline.pkl")
print(type(model))
print(model)

