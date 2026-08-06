from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.agent import Agent

app = FastAPI(title="Autonomous Agent MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunRequest(BaseModel):
    goal: str


@app.get("/")
def index():
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.post("/api/run")
def run_agent(req: RunRequest):
    goal = req.goal.strip()
    if not goal:
        raise HTTPException(status_code=400, detail="goal must not be empty")

    try:
        agent = Agent()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    result = agent.run(goal)
    return result


@app.get("/api/health")
def health():
    return {"status": "ok"}
