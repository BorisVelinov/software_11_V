import math
import os
from typing import List
from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, Integer, String, Float, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship

# --- DATABASE SETUP ---
DATABASE_URL = "sqlite:///./rideshare.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- DATABASE MODELS ---
class Ride(Base):
    __tablename__ = "rides"
    id = Column(Integer, primary_key=True, index=True)
    driver_name = Column(String, nullable=False)
    origin_name = Column(String, nullable=False)
    dest_name = Column(String, nullable=False)
    origin_lat = Column(Float, nullable=False)
    origin_lng = Column(Float, nullable=False)
    dest_lat = Column(Float, nullable=False)
    dest_lng = Column(Float, nullable=False)
    available_seats = Column(Integer, nullable=False)
    price_per_seat = Column(Float, nullable=False)
    status = Column(String, default="open")

    bookings = relationship("Booking", back_populates="ride")

class Booking(Base):
    __tablename__ = "bookings"
    id = Column(Integer, primary_key=True, index=True)
    ride_id = Column(Integer, ForeignKey("rides.id"))
    rider_name = Column(String, nullable=False)
    seats_booked = Column(Integer, default=1)

    ride = relationship("Ride", back_populates="bookings")

Base.metadata.create_all(bind=engine)

# --- PYDANTIC SCHEMAS ---
class RideCreate(BaseModel):
    driver_name: str
    origin_name: str
    dest_name: str
    origin_lat: float
    origin_lng: float
    dest_lat: float
    dest_lng: float
    available_seats: int = Field(..., ge=1, le=8)
    price_per_seat: float = Field(..., ge=0)  # ДОБАВЕНО: Ръчна цена

class BookingCreate(BaseModel):
    rider_name: str
    seats_booked: int = Field(default=1, ge=1)

# --- WEBSOCKET MANAGER ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.append(connection)
        for conn in dead_connections:
            self.disconnect(conn)

manager = ConnectionManager()

# --- FASTAPI APP ---
app = FastAPI(title="Shared Rides MVP")
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/")
def serve_frontend():
    return FileResponse("index.html")

@app.get("/api/rides")
def list_rides(db: Session = Depends(get_db)):
    rides = db.query(Ride).all()
    result = []
    for r in rides:
        result.append({
            "id": r.id,
            "driver_name": r.driver_name,
            "origin_name": r.origin_name,
            "dest_name": r.dest_name,
            "origin_lat": r.origin_lat,
            "origin_lng": r.origin_lng,
            "dest_lat": r.dest_lat,
            "dest_lng": r.dest_lng,
            "available_seats": r.available_seats,
            "price_per_seat": r.price_per_seat,
            "status": r.status,
            "passengers": [
                {"name": b.rider_name, "seats": b.seats_booked} for b in r.bookings
            ],
        })
    return result

@app.post("/api/rides")
async def create_ride(ride_data: RideCreate, db: Session = Depends(get_db)):
    new_ride = Ride(
        driver_name=ride_data.driver_name,
        origin_name=ride_data.origin_name,
        dest_name=ride_data.dest_name,
        origin_lat=ride_data.origin_lat,
        origin_lng=ride_data.origin_lng,
        dest_lat=ride_data.dest_lat,
        dest_lng=ride_data.dest_lng,
        available_seats=ride_data.available_seats,
        price_per_seat=ride_data.price_per_seat, # Използваме зададената цена
    )
    db.add(new_ride)
    db.commit()
    db.refresh(new_ride)

    await manager.broadcast({"event": "rides_updated"})
    return {"message": "Ride created", "ride_id": new_ride.id}

@app.post("/api/rides/{ride_id}/book")
async def book_seat(ride_id: int, booking: BookingCreate, db: Session = Depends(get_db)):
    ride = db.query(Ride).filter(Ride.id == ride_id).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    if ride.available_seats < booking.seats_booked:
        raise HTTPException(status_code=400, detail="Not enough seats available")

    ride.available_seats -= booking.seats_booked
    if ride.available_seats == 0:
        ride.status = "full"

    new_booking = Booking(
        ride_id=ride.id,
        rider_name=booking.rider_name,
        seats_booked=booking.seats_booked
    )
    db.add(new_booking)
    db.commit()

    await manager.broadcast({"event": "rides_updated"})
    return {"message": f"Booked {booking.seats_booked} seat(s) with {ride.driver_name}"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)