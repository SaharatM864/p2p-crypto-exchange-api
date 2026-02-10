# P2P Crypto Exchange API - คู่มือการติดตั้งและใช้งาน (Setup & Run Guide)

## 1. Prerequisites (สิ่งที่ต้องมี)

- **Node.js**: (แนะนำ Version 18+ หรือตามที่ระบุใน `.nvmrc`)
- **Docker & Docker Compose**: สำหรับรันฐานข้อมูล PostgreSQL
- **Git**

## 2. Environment Configuration

โปรเจกต์นี้ใช้ไฟล์ `.env` สำหรับเก็บค่า configuration ต่างๆ
ตรวจสอบไฟล์ `.env` ว่ามีการตั้งค่า `DATABASE_URL` ให้ตรงกับ `docker-compose.yml` หรือไม่

ตัวอย่างค่าใน `.env` (สำหรับการรัน Local):

```env
# Database (PostgreSQL) - ต้องตรงกับใน docker-compose.yml
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=p2p_exchange
POSTGRES_PORT=5432

# Prisma Connection String
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public"

# App Config
PORT=3000
JWT_SECRET=your_super_secret_key_change_me
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

## 3. ขั้นตอนการรัน (Step-by-Step)

### Step 1: Start Database

เนื่องจากโปรเจกต์นี้ใช้ Docker แค่รัน Database (ไม่ได้รันตัว App ใน Docker) ดังนั้นเราต้องเริ่มจากรัน Database ขึ้นมาก่อน:

```bash
docker-compose up -d
```

_คำสั่งนี้จะดึง image `postgres:16-alpine` และสร้าง container ชื่อ `p2p_exchange_db`_

### Step 2: Install Dependencies

ติดตั้ง libraries ต่างๆ ที่จำเป็น:

```bash
npm install
```

### Step 3: Setup Database (Prisma)

เมื่อ Database รันแล้ว เราต้องสร้าง Table ตาม schema:

```bash
# สร้าง Tables ตาม schema.prisma
npx prisma migrate dev --name init

# (Optional) สร้างข้อมูลเริ่มต้น เช่น user admin หรือ currency (ถ้ามี seed script)
npm run seed  # หรือ npx prisma db seed
```

### Step 4: Start Application

รันตัว API server:

```bash
# โหมด Development (มี watch mode แก้โค้ดแล้วรีสตาร์ทเอง)
npm run start:dev
```

ถ้าสำเร็จ จะเห็น log ว่า:
`[Nest] ... Javascript Application is running on: http://localhost:3000`

---

## 4. วิธีการทดสอบและยิง API

### วิธีที่ 1: Swagger UI (แนะนำสำหรับดู Quick Doc)

เปิด Browser ไปที่: **[http://localhost:3000/api/docs](http://localhost:3000/api/docs)**

- คุณจะเห็นรายการ API ทั้งหมดแยกตาม Module
- สามารถกด **Try it out** เพื่อยิง request จริงได้จากหน้าเว็บเลย
- **Authentication**: ถ้า API ไหนมีรูปกุญแจล็อค ต้อง Login ก่อนแล้วเอา Token มาใส่ (กดปุ่ม Authorize ด้านบนขวา)

### วิธีที่ 2: Postman (แนะนำสำหรับการเทสจริงจัง)

ในโฟลเดอร์ `postman/` มีไฟล์ที่เตรียมไว้ให้แล้ว:

1. เปิด Postman
2. กด **Import**
3. ลากไฟล์ `postman/P2P-Crypto-Exchange-API.postman_collection.json` และ `postman/P2P-Crypto-Exchange-API.postman_environment.json` เข้าไป
4. เลือก Environment เป็น **Development** (หรือตามที่ import เข้าไป)
5. เริ่มยิง API ได้เลย (เช่น Register -> Login -> เอา Token ไปใส่ใน Variable เพื่อยิง endpoints อื่นๆ)

## 5. Project Structure Overview

- **src/auth**: ระบบสมัครสมาชิก/เข้าสู่ระบบ (JWT)
- **src/wallets**: กระเป๋าเงิน (Deposit/Withdraw/Transfer)
- **src/orders**: การสร้างใบสั่งซื้อขาย (Buy/Sell)
- **src/trades**: การจับคู่แลกเปลี่ยน (Matching/Execution)
- **src/common**: ของที่ใช้ร่วมกัน (DTO, Decorators, Guards)
