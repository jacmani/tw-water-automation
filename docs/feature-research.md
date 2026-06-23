# Trinity World Water Automation — Feature Research

## Google Cloud Integrations

| Feature | GCP Services | Value |
|---------|-------------|-------|
| AI Water Demand Forecaster | BigQuery + Vertex AI AutoML | Predict 7-day consumption per tower; plan tanker bookings in advance |
| Anomaly Detection Pipeline | Cloud Run Functions + Pub/Sub | Detects spikes, weekend anomalies, seasonal trends — catches leaks earlier than ±15% threshold |
| Natural Language Query | Cloud Natural Language API (5K free/month) | Committee queries data in plain English — no tech knowledge needed |
| Automated Monthly PDF Reports | Cloud Run + Cloud Storage | Auto-email committee on 1st of month with charts, anomalies, YoY comparison |
| Water Waste Estimator | BigQuery ML | Track input vs output diff over time; estimate monthly kL loss and cost for AGM |

**Recommended build order:** BigQuery mirror → Forecaster → Waste Estimator → PDF Reports → NL Query

---

## AI Features

| Feature | How | Value |
|---------|-----|-------|
| Leak Detector | `diff` widens 3+ consecutive days → alert "Possible pipe leak in [zone]" | Early leak detection saves thousands of litres |
| Tanker Need Predictor | Well levels + consumption trend → "Order tanker for Jupiter by Thursday" | Prevents dry tank emergencies |
| Conservation Score | Weekly 0–100 score per tower vs 30-day avg | Gamifies reduction; committee accountability |
| Anomaly Explainer | Claude auto-generates plain-English spike reason | "Neptune DR spiked 40% — likely weekend guest activity" |
| Tank Empty ETA | Current cm% + avg daily rate → "JDO empties in ~14 hours" | Operational emergency prevention |
| AGM Report Generator | One-click: Claude synthesises full year → committee-ready PDF | Replaces manual annual reporting |
| Technician Smart Reminder | No upload by 9AM → WhatsApp with yesterday's numbers pre-filled | Ensures daily data continuity |
| Per-Well Efficiency Tracker | Track yield per well over months; declining yield = maintenance alert | Preventive infrastructure maintenance |

**Highest value first:** Tank Empty ETA + Leak Detector

---

## Regular Features

### Data & Reporting
- CSV/Excel export for any date range
- Year-over-year consumption comparison view
- Per-tower budget vs actual tracking
- Printable daily report (A4 PDF)

### Alerts & Notifications
- WhatsApp Business API integration
- SMS alerts via Twilio
- Custom alert thresholds per tower (configurable by committee)
- Missed upload escalation chain (technician → supervisor → president)

### Upload & Data Entry
- Bulk historical data import via CSV
- Manual correction of any saved entry
- Side-by-side old vs new comparison on re-upload
- Voice note upload → AI transcribes readings

### Committee & Governance
- AGM minutes storage and search
- Voting/resolution tracker
- Document vault (maintenance records, water bills, contracts)
- Term handover report auto-generation

### Operations
- Maintenance log (pump repairs, tank cleaning dates)
- Vendor/tanker contact directory
- Bill tracker (electricity for pumps, tanker costs)
- SLA tracker for repair response times

### Resident Facing
- Public read-only consumption dashboard (shareable link)
- Per-flat water allocation tracker
- Digital notice board integration

### System & Infrastructure
- Full audit log (who changed what, when)
- Multi-property support (other apartment complexes)
- Progressive Web App (PWA) — installable on mobile
- Offline upload queue (upload when connectivity restored)
- Google Cloud Vision as OCR date fallback (1,000 free units/month)

---

*Generated: June 2026 | Project: tw-water-automation*
