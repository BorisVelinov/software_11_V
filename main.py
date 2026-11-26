import hashlib
import hmac
import json
import os
import secrets
from typing import List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import Column, Float, ForeignKey, Integer, String, create_engine
from sqlalchemy.orm import Session, declarative_base, relationship, sessionmaker

# --- DATABASE SETUP ---
DATABASE_URL = "sqlite:///./rideshare.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# --- AUTH HELPERS ---
def hash_password(password: str, salt: Optional[str] = None) -> str:
    if not salt:
        salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, expected_digest = stored_hash.split("$", 1)
    except ValueError:
        return False
    actual_digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000
    ).hex()
    return hmac.compare_digest(actual_digest, expected_digest)


# --- DATABASE MODELS ---
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    full_name = Column(String, nullable=False)
    phone = Column(String, default="")
    password_hash = Column(String, nullable=False)
    role = Column(String, default="user")  # "user" | "admin"
    token = Column(String, unique=True, index=True, nullable=True)


class Ride(Base):
    __tablename__ = "rides"
    id = Column(Integer, primary_key=True, index=True)
    driver_name = Column(String, nullable=False)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    origin_name = Column(String, nullable=False)
    dest_name = Column(String, nullable=False)
    origin_lat = Column(Float, nullable=False)
    origin_lng = Column(Float, nullable=False)
    dest_lat = Column(Float, nullable=False)
    dest_lng = Column(Float, nullable=False)
    stops_json = Column(String, default="[]")
    total_seats = Column(Integer, nullable=False)
    available_seats = Column(Integer, nullable=False)
    price_per_seat = Column(Float, nullable=False)
    status = Column(String, default="open")  # "open" | "full" | "cancelled"

    bookings = relationship("Booking", back_populates="ride", cascade="all, delete-orphan")


class Booking(Base):
    __tablename__ = "bookings"
    id = Column(Integer, primary_key=True, index=True)
    ride_id = Column(Integer, ForeignKey("rides.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    rider_name = Column(String, nullable=False)
    seats_booked = Column(Integer, default=1)
    segment_start_label = Column(String, nullable=False)
    segment_end_label = Column(String, nullable=False)
    segment_start_ratio = Column(Float, default=0.0)
    segment_end_ratio = Column(Float, default=1.0)
    segment_price = Column(Float, nullable=False)

    ride = relationship("Ride", back_populates="bookings")


Base.metadata.create_all(bind=engine)


def seed_default_users():
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").first()
        if not admin:
            admin = User(
                username="admin",
                full_name="Администратор",
                phone="+359 88 000 0000",
                password_hash=hash_password("admin123"),
                role="admin",
                token=secrets.token_hex(24),
            )
            db.add(admin)
            db.commit()
    finally:
        db.close()


seed_default_users()


# --- SEGMENT & AVAILABILITY HELPERS ---
def segments_overlap(s1: float, e1: float, s2: float, e2: float) -> bool:
    return max(s1, s2) < min(e1, e2) - 1e-4


def recompute_ride_availability(ride: Ride) -> None:
    if ride.status == "cancelled":
        ride.available_seats = 0
        return
    peak_booked = 0
    for step in range(100):
        probe = (step + 0.5) / 100.0
        concurrent = sum(
            b.seats_booked
            for b in ride.bookings
            if (b.segment_start_ratio - 1e-4) <= probe <= (b.segment_end_ratio + 1e-4)
        )
        if concurrent > peak_booked:
            peak_booked = concurrent
    ride.available_seats = max(0, ride.total_seats - peak_booked)
    ride.status = "full" if ride.available_seats == 0 else "open"


def parse_stops(ride: Ride) -> list:
    try:
        stops = json.loads(ride.stops_json or "[]")
        if isinstance(stops, list):
            return stops
    except Exception:
        pass
    return []


# --- PYDANTIC SCHEMAS ---
class StopItem(BaseModel):
    name: str
    lat: float
    lng: float
    ratio: Optional[float] = None


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=40)
    full_name: str = Field(..., min_length=2, max_length=80)
    phone: str = Field(default="", max_length=30)
    password: str = Field(..., min_length=4, max_length=100)

    @field_validator("username", "full_name")
    @classmethod
    def non_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Полето не може да е празно.")
        return v.strip()


class LoginRequest(BaseModel):
    username: str
    password: str


class ProfileUpdateRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=80)
    phone: str = Field(default="", max_length=30)


class RideCreate(BaseModel):
    driver_name: str
    origin_name: str
    dest_name: str
    origin_lat: float
    origin_lng: float
    dest_lat: float
    dest_lng: float
    stops: List[StopItem] = Field(default_factory=list)
    available_seats: int = Field(..., ge=1, le=8)
    price_per_seat: float = Field(..., ge=0)

    @field_validator("driver_name", "origin_name", "dest_name")
    @classmethod
    def non_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Полето не може да е празно.")
        return v.strip()


class RideStatusUpdate(BaseModel):
    status: str


class BookingCreate(BaseModel):
    seats_booked: int = Field(default=1, ge=1, le=8)
    segment_start_label: Optional[str] = None
    segment_end_label: Optional[str] = None
    segment_start_ratio: Optional[float] = Field(default=0.0, ge=0.0, le=1.0)
    segment_end_ratio: Optional[float] = Field(default=1.0, ge=0.0, le=1.0)


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
        dead = []
        for conn in self.active_connections:
            try:
                await conn.send_json(message)
            except Exception:
                dead.append(conn)
        for conn in dead:
            self.disconnect(conn)


manager = ConnectionManager()


# --- FASTAPI APP ---
app = FastAPI(title="Споделени Пътувания")
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


def get_optional_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Optional[User]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None
    return db.query(User).filter(User.token == token).first()


def require_user(user: Optional[User] = Depends(get_optional_user)) -> User:
    if not user:
        raise HTTPException(status_code=401, detail="Само потребители с профил могат да запазват места.")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Изискват се администраторски права.")
    return user


def serialize_ride(ride: Ride) -> dict:
    return {
        "id": ride.id,
        "driver_name": ride.driver_name,
        "owner_user_id": ride.owner_user_id,
        "origin_name": ride.origin_name,
        "dest_name": ride.dest_name,
        "origin_lat": ride.origin_lat,
        "origin_lng": ride.origin_lng,
        "dest_lat": ride.dest_lat,
        "dest_lng": ride.dest_lng,
        "stops": parse_stops(ride),
        "total_seats": ride.total_seats,
        "available_seats": ride.available_seats,
        "price_per_seat": ride.price_per_seat,
        "status": ride.status,
        "passengers": [
            {
                "id": b.id,
                "name": b.rider_name,
                "seats": b.seats_booked,
                "segment_start_label": b.segment_start_label,
                "segment_end_label": b.segment_end_label,
                "segment_start_ratio": b.segment_start_ratio,
                "segment_end_ratio": b.segment_end_ratio,
                "segment_price": b.segment_price,
            }
            for b in ride.bookings
        ],
    }


@app.get("/")
def serve_frontend():
    return FileResponse("index.html")


# --- AUTH & PROFILE ---
@app.post("/api/auth/register")
def register_user(req: RegisterRequest, db: Session = Depends(get_db)):
    uname = req.username.strip().lower()
    if db.query(User).filter(User.username == uname).first():
        raise HTTPException(status_code=400, detail="Потребителското име вече е заето.")
    user = User(
        username=uname,
        full_name=req.full_name.strip(),
        phone=req.phone.strip(),
        password_hash=hash_password(req.password),
        role="user",
        token=secrets.token_hex(24),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {
        "token": user.token,
        "user": {
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "phone": user.phone,
            "role": user.role,
        },
    }


@app.post("/api/auth/login")
def login_user(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username.strip().lower()).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Невалидно потребителско име или парола.")
    if not user.token:
        user.token = secrets.token_hex(24)
        db.commit()
    return {
        "token": user.token,
        "user": {
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "phone": user.phone,
            "role": user.role,
        },
    }


@app.get("/api/profile")
def get_profile(user: User = Depends(require_user), db: Session = Depends(get_db)):
    my_rides = db.query(Ride).filter(Ride.owner_user_id == user.id).order_by(Ride.id.desc()).all()
    my_bookings = db.query(Booking).filter(Booking.user_id == user.id).order_by(Booking.id.desc()).all()
    bookings_out = []
    for b in my_bookings:
        ride = db.query(Ride).filter(Ride.id == b.ride_id).first()
        bookings_out.append({
            "id": b.id,
            "ride_id": b.ride_id,
            "driver_name": ride.driver_name if ride else "—",
            "full_route": f"{ride.origin_name} → {ride.dest_name}" if ride else "—",
            "segment_start_label": b.segment_start_label,
            "segment_end_label": b.segment_end_label,
            "seats_booked": b.seats_booked,
            "segment_price": b.segment_price,
        })
    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "phone": user.phone,
            "role": user.role,
        },
        "rides": [serialize_ride(r) for r in my_rides],
        "bookings": bookings_out,
    }


@app.put("/api/profile")
def update_profile(req: ProfileUpdateRequest, user: User = Depends(require_user), db: Session = Depends(get_db)):
    if not req.full_name.strip():
        raise HTTPException(status_code=400, detail="Името не може да е празно.")
    user.full_name = req.full_name.strip()
    user.phone = req.phone.strip()
    db.commit()
    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "phone": user.phone,
            "role": user.role,
        }
    }


# --- RIDES & PARTIAL BOOKINGS ---
@app.get("/api/rides")
def list_rides(
    origin: Optional[str] = None,
    destination: Optional[str] = None,
    min_seats: int = 1,
    db: Session = Depends(get_db),
):
    rides = db.query(Ride).order_by(Ride.id.desc()).all()
    result = []
    for r in rides:
        if r.status == "cancelled":
            continue
        if min_seats > 1 and r.available_seats < min_seats:
            continue
        stops = parse_stops(r)
        all_places = " ".join([r.origin_name, r.dest_name] + [s.get("name", "") for s in stops]).lower()
        if origin and origin.strip():
            o = origin.strip().lower()
            if o not in r.origin_name.lower() and o not in all_places:
                continue
        if destination and destination.strip():
            d = destination.strip().lower()
            if d not in r.dest_name.lower() and d not in all_places:
                continue
        result.append(serialize_ride(r))
    return result


@app.post("/api/rides")
async def create_ride(
    ride_data: RideCreate,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    stops_sorted = []
    total_stops = len(ride_data.stops)
    for idx, st in enumerate(ride_data.stops):
        ratio = st.ratio if st.ratio is not None else round((idx + 1) / (total_stops + 1), 3)
        stops_sorted.append({
            "name": st.name.strip(),
            "lat": st.lat,
            "lng": st.lng,
            "ratio": max(0.05, min(0.95, float(ratio))),
        })
    stops_sorted.sort(key=lambda s: s["ratio"])

    new_ride = Ride(
        driver_name=ride_data.driver_name.strip(),
        owner_user_id=user.id if user else None,
        origin_name=ride_data.origin_name.strip(),
        dest_name=ride_data.dest_name.strip(),
        origin_lat=ride_data.origin_lat,
        origin_lng=ride_data.origin_lng,
        dest_lat=ride_data.dest_lat,
        dest_lng=ride_data.dest_lng,
        stops_json=json.dumps(stops_sorted, ensure_ascii=False),
        total_seats=ride_data.available_seats,
        available_seats=ride_data.available_seats,
        price_per_seat=ride_data.price_per_seat,
        status="open",
    )
    db.add(new_ride)
    db.commit()
    db.refresh(new_ride)

    await manager.broadcast({"event": "rides_updated"})
    return {"message": "Пътуването е създадено.", "ride_id": new_ride.id}


@app.post("/api/rides/{ride_id}/book")
async def book_seat(
    ride_id: int,
    booking: BookingCreate,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    ride = db.query(Ride).filter(Ride.id == ride_id).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Пътуването не е намерено.")
    if ride.status == "cancelled":
        raise HTTPException(status_code=400, detail="Пътуването е отменено.")

    start_ratio = float(booking.segment_start_ratio if booking.segment_start_ratio is not None else 0.0)
    end_ratio = float(booking.segment_end_ratio if booking.segment_end_ratio is not None else 1.0)
    if end_ratio <= start_ratio + 1e-4:
        raise HTTPException(status_code=400, detail="Крайната точка трябва да е след началната.")

    overlapping = sum(
        b.seats_booked
        for b in ride.bookings
        if segments_overlap(start_ratio, end_ratio, b.segment_start_ratio, b.segment_end_ratio)
    )
    free_for_segment = ride.total_seats - overlapping
    if free_for_segment < booking.seats_booked:
        raise HTTPException(
            status_code=400,
            detail=f"Няма достатъчно свободни места за този участък (свободни: {max(0, free_for_segment)}).",
        )

    start_label = (booking.segment_start_label or "").strip() or ride.origin_name
    end_label = (booking.segment_end_label or "").strip() or ride.dest_name

    span = max(0.05, end_ratio - start_ratio)
    factor = 1.0 if span >= 0.97 else max(0.15, round(span, 2))
    unit_price = round(ride.price_per_seat * factor, 2)
    total_price = round(unit_price * booking.seats_booked, 2)

    new_booking = Booking(
        ride_id=ride.id,
        user_id=user.id,
        rider_name=user.full_name,
        seats_booked=booking.seats_booked,
        segment_start_label=start_label,
        segment_end_label=end_label,
        segment_start_ratio=round(start_ratio, 4),
        segment_end_ratio=round(end_ratio, 4),
        segment_price=total_price,
    )
    db.add(new_booking)
    db.flush()
    recompute_ride_availability(ride)
    db.commit()

    await manager.broadcast({"event": "rides_updated"})
    return {
        "message": f"Запазено ({start_label} → {end_label}) за {total_price:.2f} лв.",
        "segment_price": total_price,
    }


@app.delete("/api/bookings/{booking_id}")
async def cancel_booking(
    booking_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Резервацията не е намерена.")
    ride = db.query(Ride).filter(Ride.id == booking.ride_id).first()
    is_allowed = (user.role == "admin") or (booking.user_id == user.id) or (ride and ride.owner_user_id == user.id)
    if not is_allowed:
        raise HTTPException(status_code=403, detail="Нямаш права за тази резервация.")

    db.delete(booking)
    if ride:
        db.flush()
        recompute_ride_availability(ride)
    db.commit()

    await manager.broadcast({"event": "rides_updated"})
    return {"message": "Резервацията е отменена."}


# --- ADMIN ---
@app.get("/api/admin/rides")
def admin_list_all_rides(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    rides = db.query(Ride).order_by(Ride.id.desc()).all()
    return [serialize_ride(r) for r in rides]


@app.patch("/api/admin/rides/{ride_id}/status")
async def admin_update_status(
    ride_id: int,
    payload: RideStatusUpdate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if payload.status not in {"open", "full", "cancelled"}:
        raise HTTPException(status_code=400, detail="Невалиден статус.")
    ride = db.query(Ride).filter(Ride.id == ride_id).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Пътуването не е намерено.")
    ride.status = payload.status
    if payload.status == "open":
        recompute_ride_availability(ride)
        if ride.available_seats == 0:
            ride.status = "open"
    elif payload.status == "cancelled":
        ride.available_seats = 0
    db.commit()
    await manager.broadcast({"event": "rides_updated"})
    return {"message": "Статусът е обновен."}


@app.delete("/api/admin/rides/{ride_id}")
async def admin_delete_ride(
    ride_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    ride = db.query(Ride).filter(Ride.id == ride_id).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Пътуването не е намерено.")
    db.delete(ride)
    db.commit()
    await manager.broadcast({"event": "rides_updated"})
    return {"message": "Пътуването е изтрито."}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)