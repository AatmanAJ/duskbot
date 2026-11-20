# Attachments the stress eval sends: a receipt photo, a whiteboard photo, a chart, an invoice and a CV as PDFs, and
# three CSVs whose right answers the scenarios name. Deterministic; written to the folder given as the only argument.
import csv, random, sys, os
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

def font(size):
    for path in ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"]:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()

def receipt():
    img = Image.new("RGB", (520, 760), "white")
    d = ImageDraw.Draw(img)
    lines = ["TRATTORIA LUCA", "12 Hill Rd, Bandra West", "Table 7   Guests: 4", "21/11/2026  20:41", "",
             "2 x Margherita Pizza      840.00", "1 x Penne Arrabbiata      395.00", "1 x Risotto Funghi        520.00",
             "3 x Fresh Lime Soda       360.00", "1 x Tiramisu              310.00", "",
             "Subtotal                 2425.00", "GST 5%                    121.25", "Service charge 10%        242.50",
             "TOTAL                    2788.75", "", "Paid: UPI", "Thank you, come again!"]
    y = 30
    for line in lines:
        d.text((40, y), line, fill="black", font=font(22))
        y += 38
    img.rotate(2, expand=True, fillcolor="#eeeeee").save(f"{out}/receipt.png")

def whiteboard():
    img = Image.new("RGB", (900, 600), "#f7f7f2")
    d = ImageDraw.Draw(img)
    d.text((40, 30), "Launch plan - Q1", fill="#1a3", font=font(40))
    items = ["1. Landing page copy  -> Priya (Dec 2)", "2. Pricing: 3 tiers, $9 / $19 / $49", "3. Beta invites to 200 users -> Arjun",
             "4. Fix onboarding bug #212 !!", "5. Press kit + demo video (Dec 9)", "Launch date: Jan 14"]
    y = 120
    for item in items:
        d.text((60, y), item, fill="#123" if "!!" not in item else "#c00", font=font(30))
        y += 70
    img.save(f"{out}/whiteboard.jpg", quality=85)

def chart():
    img = Image.new("RGB", (800, 500), "white")
    d = ImageDraw.Draw(img)
    d.text((30, 15), "Monthly revenue 2026 (USD thousands)", fill="black", font=font(24))
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
    vals = [42, 38, 51, 47, 63, 58]
    for i, (m, v) in enumerate(zip(months, vals)):
        x = 80 + i * 115
        d.rectangle([x, 450 - v * 6, x + 70, 450], fill="#3b6ea5")
        d.text((x + 15, 455), m, fill="black", font=font(20))
        d.text((x + 18, 450 - v * 6 - 26), str(v), fill="black", font=font(20))
    img.save(f"{out}/revenue-chart.png")

def invoice():
    c = canvas.Canvas(f"{out}/invoice-INV-2291.pdf", pagesize=A4)
    lines = ["BRIGHTPRINT STUDIO LLP", "Invoice INV-2291", "Date: 2026-11-04    Due: 2026-11-25", "Bill to: Kaveri Foods Pvt Ltd", "",
             "Item                                   Qty    Rate      Amount", "Product label design (3 SKUs)           3   12,000    36,000",
             "Packaging mockups                        1    8,500     8,500", "Print proofing                           2    2,250     4,500", "",
             "Subtotal                                                 49,000", "GST 18%                                                   8,820",
             "Total due (INR)                                          57,820", "", "Bank: HDFC  A/C 50200011122233  IFSC HDFC0001234",
             "Late fee 2% per month after due date."]
    y = 800
    for line in lines:
        c.setFont("Courier", 10)
        c.drawString(40, y, line)
        y -= 20
    c.save()

def cv():
    c = canvas.Canvas(f"{out}/cv-meera-iyer.pdf", pagesize=A4)
    lines = ["Meera Iyer", "Customer Support Lead | Pune | meera.iyer@example.com", "",
             "Experience", "2022-2026  Support Team Lead, Zestly (SaaS, 40k customers): led 9 agents, CSAT 87% -> 94%,",
             "           cut first response time from 9h to 2h, set up Zendesk macros and a help centre.",
             "2019-2022  Senior Support Agent, PayNest: billing disputes, chargebacks, Hindi/English/Marathi support.",
             "2017-2019  Call centre agent, Teleperf.", "", "Skills: Zendesk, Intercom, Freshdesk, SQL basics, Looker dashboards, hiring and coaching.",
             "Education: B.Com, Savitribai Phule Pune University, 2017", "Notice period: 60 days. Expected CTC: 14 LPA."]
    y = 800
    for line in lines:
        c.setFont("Helvetica", 10)
        c.drawString(40, y, line)
        y -= 18
    c.save()

def sales():
    random.seed(7)
    rows = []
    products = [("Cold brew 1L", 450), ("Oat latte can", 180), ("Matcha kit", 1200), ("Gift box", 2200)]
    regions = ["Mumbai", "Pune", "Bangalore"]
    for day in range(1, 31):
        for _ in range(2):
            p, price = random.choice(products)
            rows.append([f"2026-10-{day:02d}", p, random.choice(regions), random.randint(1, 6), price])
    with open(f"{out}/october-sales.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "product", "region", "qty", "unit_price_inr"])
        w.writerows(rows)
    by_product, by_region = {}, {}
    for r in rows:
        rev = r[3] * r[4]
        by_product[r[1]] = by_product.get(r[1], 0) + rev
        by_region[r[2]] = by_region.get(r[2], 0) + rev
    return {"rows": len(rows), "total": sum(by_product.values()), "by_product": by_product, "by_region": by_region}

def bank():
    rows = [["2026-11-01", "AWS", -8450.0], ["2026-11-02", "Client payment - Kaveri Foods", 57820.0], ["2026-11-03", "Swiggy", -640.0],
            ["2026-11-05", "WeWork", -18000.0], ["2026-11-06", "Google Workspace", -1380.0], ["2026-11-08", "Uber", -420.0],
            ["2026-11-09", "Client payment - Nimbus", 120000.0], ["2026-11-11", "Figma", -1250.0], ["2026-11-12", "Swiggy", -890.0],
            ["2026-11-14", "Freelancer - Rohan (design)", -25000.0], ["2026-11-15", "AWS", -1200.0], ["2026-11-18", "Uber", -510.0]]
    with open(f"{out}/bank-november.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "description", "amount_inr"])
        w.writerows(rows)
    income = sum(r[2] for r in rows if r[2] > 0)
    spend = sum(-r[2] for r in rows if r[2] < 0)
    return {"income": income, "spend": spend, "net": income - spend}

def leads():
    rows = [["Ananya Rao", "Kaveri Foods", "Head of Marketing", "inbound demo", "2026-11-18", "hot"],
            ["Tom Becker", "Nordwind GmbH", "COO", "webinar", "2026-11-02", "cold"],
            ["Lucia Mendes", "Casa Verde", "Founder", "referral", "2026-11-15", "warm"],
            ["Imran Sheikh", "QuickCart", "VP Ops", "inbound demo", "2026-11-19", "hot"],
            ["Sara Kim", "Lumen Labs", "CEO", "cold email reply", "2026-10-28", "warm"],
            ["Diego Alvarez", "Pampa Coffee", "Owner", "trade show", "2026-11-10", "warm"]]
    with open(f"{out}/leads.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["name", "company", "title", "source", "last_contact", "status"])
        w.writerows(rows)

receipt(); whiteboard(); chart(); invoice(); cv(); leads()
import json
print(json.dumps({"sales": sales(), "bank": bank()}))
