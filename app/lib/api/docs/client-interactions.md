# Client Interactions API Specification

This document describes the API endpoints for the Client Interactions dashboard.
Use this alongside `client-interactions.ts` to build the FastAPI backend.

## Base URL

```
/api/client-interactions
```

## Overview

The Client Interactions API provides endpoints for managing client engagement data including:
- Dashboard metrics and visualizations
- Paginated engagement lists with filtering
- CRUD operations for engagements
- Data export functionality

### Design Principles

1. **Minimal Data Transfer**: The API is designed to return only the data needed for each use case
2. **Pre-computed Aggregations**: Metrics and breakdowns are computed server-side to reduce client processing
3. **Efficient Pagination**: Large datasets are paginated to ensure fast initial load
4. **Optimized Updates**: Dedicated endpoints for common updates (status, NNA, notes) to minimize payload size

### Naming Convention

**IMPORTANT**: The API uses `snake_case` for all JSON keys in requests and responses.
The frontend automatically converts between `snake_case` (API) and `camelCase` (TypeScript) using the `toCamelCase()` helper.

Example:
- API sends: `{ "external_client": "Acme", "internal_client": { "client_department": "Advisory" } }`
- Frontend receives: `{ "externalClient": "Acme", "internalClient": { "clientDept": "Advisory" } }`

---

## Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/dashboard` | Fetch all dashboard data (initial load) |
| GET | `/engagements` | Paginated engagements with filtering |
| GET | `/metrics` | Dashboard metrics only |
| GET | `/departments` | Department breakdown chart data |
| GET | `/contribution` | Contribution heatmap data |
| POST | `/engagements` | Create new engagement |
| PATCH | `/engagements/:id` | Update engagement (partial) |
| PATCH | `/engagements/:id/status` | Update status only |
| PATCH | `/engagements/:id/nna` | Update NNA only |
| PATCH | `/engagements/:id/notes` | Update notes only |
| DELETE | `/engagements/:id` | Delete engagement |
| GET | `/engagements/export` | Export to CSV |

---

## Endpoints

### POST /dashboard

Fetch all dashboard data in a single optimized call. This is the primary endpoint for initial page load.

**Why POST?** The request body contains complex filter arrays that are easier to handle as JSON body than URL parameters.

**Request Body:**

```json
{
  "period": "1Y",
  "team_member": "Alex M.",
  "departments": ["Advisory", "Brokerage"],
  "intake_types": ["IRQ", "SERF"],
  "project_types": ["Meeting", "Data Request"],
  "search": "Vanguard",
  "status": "In Progress",
  "page": 1,
  "page_size": 50,
  "sort_column": "date_started",
  "sort_direction": "desc"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `period` | string | No | Time period: `1W`, `1M`, `3M`, `6M`, `YTD`, `1Y`, `ALL`. Default: `1Y` |
| `team_member` | string | No | Filter by team member name or office (`Office B`, `Office A`) |
| `departments` | string[] | No | Multi-select: `Advisory`, `Brokerage`, `Institutional` |
| `intake_types` | string[] | No | Multi-select: `IRQ`, `SERF`, `Ad-Hoc` |
| `project_types` | string[] | No | Multi-select: `Meeting`, `Discovery Meeting`, `Data Request`, `Data Update`, `PCR`, `Other` |
| `search` | string | No | Text search across client names, types, departments |
| `status` | string | No | Filter by status: `In Progress`, `Pending`, `Completed` |
| `page` | number | No | Page number for engagements (default: 1) |
| `page_size` | number | No | Engagements per page (default: 50) |
| `sort_column` | string | No | Column to sort by (e.g., `date_started`, `external_client`) |
| `sort_direction` | string | No | `asc` or `desc` (default: `desc`) |

**Response (200 OK):**

```json
{
  "metrics": {
    "client_projects": {
      "count": 245,
      "change_percent": 12,
      "period_label": "YoY",
      "intake_source_breakdown": {
        "irq_count": 156,
        "irq_percent": 64,
        "serf_count": 89,
        "serf_percent": 36,
        "portfolios_logged": 198,
        "portfolios_total": 245,
        "portfolios_percent": 81
      }
    },
    "ad_hoc": {
      "count": 87,
      "change_percent": 18,
      "period_label": "YoY",
      "intake_breakdown": [
        { "intake": "In-Person", "count": 32, "percent": 37, "color": "#a5f3fc" },
        { "intake": "Email", "count": 41, "percent": 47, "color": "#22d3ee" },
        { "intake": "Teams", "count": 14, "percent": 16, "color": "#0e7490" }
      ]
    },
    "in_progress": {
      "count": 23,
      "change": 2,
      "sparkline_data": [
        { "value": 18 }, { "value": 19 }, { "value": 21 },
        { "value": 20 }, { "value": 22 }, { "value": 21 },
        { "value": 21 }, { "value": 23 }
      ]
    },
    "nna": {
      "total": 2450000000,
      "project_count": 45,
      "change_percent": 8,
      "tiers": [
        { "label": "<$50M", "count": 28, "color": "#0e7490" },
        { "label": "$50-200M", "count": 12, "color": "#22d3ee" },
        { "label": "$200M+", "count": 5, "color": "#39FF14" }
      ]
    }
  },
  "departments": {
    "departments": [
      { "name": "Advisory", "value": 55, "count": 135, "color": "#a5f3fc" },
      { "name": "Brokerage", "value": 33, "count": 81, "color": "#22d3ee" },
      { "name": "Institutional", "value": 12, "count": 29, "color": "#0e7490" }
    ],
    "total": 245
  },
  "contribution_data": {
    "weeks": [
      [
        { "date": "2024-02-01", "level": 2, "count": 3, "project_count": 2, "ad_hoc_count": 1 },
        { "date": "2024-02-02", "level": 0, "count": 0, "project_count": 0, "ad_hoc_count": 0 }
      ]
    ],
    "total_days": 365,
    "max_count": 8
  },
  "engagements": {
    "engagements": [
      {
        "id": 1234,
        "external_client": "Vanguard Advisors",
        "internal_client": {
          "name": "Avery Bennett",
          "client_department": "Advisory"
        },
        "intake_type": "Ad-Hoc",
        "ad_hoc_channel": "In-Person",
        "type": "Meeting",
        "team_members": ["Alex M.", "Blake N."],
        "department": "Advisory",
        "date_started": "Jan 15, 2025",
        "date_finished": "Jan 20, 2025",
        "status": "Completed",
        "portfolio_logged": true,
        "nna": 25000000,
        "notes": "Client requested additional sector breakdowns.",
        "tickers_mentioned": ["AAPL", "MSFT"]
      }
    ],
    "total": 332,
    "page": 1,
    "page_size": 50,
    "has_more": true
  },
  "filter_options": {
    "team_members": ["All Team Members", "Office B", "Office A"],
    "team_member_groups": [
      { "label": "Office", "options": ["Office B", "Office A"] }
    ],
    "departments": ["Brokerage", "Advisory", "Institutional"],
    "intake_types": ["Ad-Hoc", "SERF", "IRQ"],
    "project_types": ["Data Request", "Discovery Meeting", "Meeting", "Other", "PCR"],
    "statuses": ["Completed", "In Progress", "On Hold"]
  }
}
```

---

### GET /engagements

Fetch paginated engagements with filtering and sorting.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search across external client, internal client, intake type, project type |
| `team_member` | string | Filter by team member or office |
| `departments` | string[] | Multi-select department filter (repeat param for multiple) |
| `intake_types` | string[] | Multi-select intake type filter (repeat param for multiple) |
| `project_types` | string[] | Multi-select project type filter (repeat param for multiple) |
| `period` | string | Time period filter |
| `status` | string | Filter by status |
| `page` | number | Page number (default: 1) |
| `page_size` | number | Results per page (default: 50) |
| `sort_column` | string | Column to sort by |
| `sort_direction` | string | `asc` or `desc` |

**Example Request:**
```
GET /engagements?page=1&page_size=50&period=1Y&departments=Advisory&departments=Brokerage&sort_column=date_started&sort_direction=desc
```

**Response (200 OK):**

```json
{
  "engagements": [
    {
      "id": 1234,
      "external_client": "Vanguard Advisors",
      "internal_client": {
        "name": "Avery Bennett",
        "client_department": "Advisory"
      },
      "intake_type": "Ad-Hoc",
      "ad_hoc_channel": "In-Person",
      "type": "Meeting",
      "team_members": ["Alex M.", "Blake N."],
      "department": "Advisory",
      "date_started": "Jan 15, 2025",
      "date_finished": "Jan 20, 2025",
      "status": "Completed",
      "portfolio_logged": true,
      "nna": 25000000,
      "notes": "Client requested additional sector breakdowns.",
      "tickers_mentioned": ["AAPL", "MSFT"]
    }
  ],
  "total": 332,
  "page": 1,
  "page_size": 50,
  "has_more": true
}
```

---

### GET /metrics

Fetch dashboard metrics only. Use for refreshing metrics without full reload.

**Query Parameters:** Same as POST `/dashboard` (as query params)

**Response (200 OK):**

```json
{
  "client_projects": {
    "count": 245,
    "change_percent": 12,
    "period_label": "YoY",
    "intake_source_breakdown": {
      "irq_count": 156,
      "irq_percent": 64,
      "serf_count": 89,
      "serf_percent": 36,
      "portfolios_logged": 198,
      "portfolios_total": 245,
      "portfolios_percent": 81
    }
  },
  "ad_hoc": {
    "count": 87,
    "change_percent": 18,
    "period_label": "YoY",
    "intake_breakdown": [
      { "intake": "In-Person", "count": 32, "percent": 37, "color": "#a5f3fc" },
      { "intake": "Email", "count": 41, "percent": 47, "color": "#22d3ee" },
      { "intake": "Teams", "count": 14, "percent": 16, "color": "#0e7490" }
    ]
  },
  "in_progress": {
    "count": 23,
    "change": 2,
    "sparkline_data": [
      { "value": 18 }, { "value": 19 }, { "value": 21 },
      { "value": 20 }, { "value": 22 }, { "value": 21 },
      { "value": 21 }, { "value": 23 }
    ]
  },
  "nna": {
    "total": 2450000000,
    "project_count": 45,
    "change_percent": 8,
    "tiers": [
      { "label": "<$50M", "count": 28, "color": "#0e7490" },
      { "label": "$50-200M", "count": 12, "color": "#22d3ee" },
      { "label": "$200M+", "count": 5, "color": "#39FF14" }
    ]
  }
}
```

---

### GET /departments

Fetch department breakdown for the chart.

**Query Parameters:** Same filter params as `/dashboard`

**Response (200 OK):**

```json
{
  "departments": [
    { "name": "Advisory", "value": 55, "count": 135, "color": "#a5f3fc" },
    { "name": "Brokerage", "value": 33, "count": 81, "color": "#22d3ee" },
    { "name": "Institutional", "value": 12, "count": 29, "color": "#0e7490" }
  ],
  "total": 245
}
```

---

### GET /contribution

Fetch contribution heatmap data (GitHub-style activity graph).

**Query Parameters:** Same filter params as `/dashboard`

**Response (200 OK):**

```json
{
  "weeks": [
    [
      {
        "date": "2024-02-01",
        "level": 2,
        "count": 3,
        "project_count": 2,
        "ad_hoc_count": 1
      },
      {
        "date": "2024-02-02",
        "level": 0,
        "count": 0,
        "project_count": 0,
        "ad_hoc_count": 0
      }
    ]
  ],
  "total_days": 365,
  "max_count": 8
}
```

**Level Calculation:**
- `level` is 0-4 based on count relative to max_count
- 0 = no activity, 4 = highest activity
- Used for heatmap cell coloring

---

### POST /engagements

Create a new engagement.

**Request Body:**

```json
{
  "client_crn": "CRN-000123",
  "internal_client": {
    "name": "Avery Bennett",
    "client_department": "Advisory"
  },
  "intake_type": "Ad-Hoc",
  "ad_hoc_channel": "In-Person",
  "type": "Meeting",
  "team_members": ["Alex M.", "Blake N."],
  "date_started": "Jan 28, 2025",
  "date_finished": "—",
  "status": "In Progress",
  "portfolio_logged": false,
  "portfolio": null,
  "nna": null,
  "notes": null,
  "tickers_mentioned": ["AAPL", "MSFT", "GOOGL"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `client_crn` | string | **Yes** | CRN of a registered external client (see the Clients registry endpoints). The canonical client name is resolved from the registry; `external_client` is returned (read-only) on responses. |
| `internal_client` | object | **Yes** | `{ name: string, client_department: string }` |
| `intake_type` | string | **Yes** | `IRQ`, `SERF`, or `Ad-Hoc` |
| `ad_hoc_channel` | string \| null | Conditional | Required if `intake_type` is `Ad-Hoc`: `In-Person`, `Email`, `Teams` |
| `type` | string | **Yes** | `Meeting`, `Discovery Meeting`, `Data Request`, `Data Update`, `PCR`, `Other` |
| `team_members` | string[] | **Yes** | Array of team member names |
| `date_started` | string | **Yes** | Formatted date: `"Jan 28, 2025"` |
| `date_finished` | string | **Yes** | Formatted date or `"—"` if not finished |
| `status` | string | **Yes** | `In Progress`, `Pending`, or `Completed` |
| `portfolio_logged` | boolean | **Yes** | Whether portfolio was logged |
| `portfolio` | array \| null | No | Portfolio holdings array |
| `nna` | number \| null | No | Net New Assets in dollars |
| `notes` | string \| null | No | Optional notes |
| `tickers_mentioned` | string[] \| null | No | Tickers discussed (Ad-Hoc only, used for Ticker Trends) |

**Response (201 Created):**

```json
{
  "id": 1234,
  "external_client": "Vanguard Advisors",
  "internal_client": {
    "name": "Avery Bennett",
    "client_department": "Advisory"
  },
  "intake_type": "Ad-Hoc",
  "ad_hoc_channel": "In-Person",
  "type": "Meeting",
  "team_members": ["Alex M.", "Blake N."],
  "department": "Advisory",
  "date_started": "Jan 28, 2025",
  "date_finished": "—",
  "status": "In Progress",
  "portfolio_logged": false,
  "nna": null,
  "notes": null,
  "tickers_mentioned": ["AAPL", "MSFT", "GOOGL"]
}
```

**Note:** The `department` field is derived from `internal_client.client_department` on the backend.

---

### PATCH /engagements/:id

Update an existing engagement with partial data.

**URL Parameters:**
- `id`: Engagement ID (number)

**Request Body:** Only include fields to update

```json
{
  "status": "Completed",
  "date_finished": "Jan 31, 2025",
  "portfolio_logged": true,
  "nna": 25000000
}
```

**Response (200 OK):** The full updated engagement object

```json
{
  "id": 1234,
  "external_client": "Vanguard Advisors",
  "internal_client": {
    "name": "Avery Bennett",
    "client_department": "Advisory"
  },
  "intake_type": "IRQ",
  "ad_hoc_channel": null,
  "type": "Meeting",
  "team_members": ["Alex M.", "Blake N."],
  "department": "Advisory",
  "date_started": "Jan 28, 2025",
  "date_finished": "Jan 31, 2025",
  "status": "Completed",
  "portfolio_logged": true,
  "nna": 25000000,
  "notes": null
}
```

---

### PATCH /engagements/:id/status

Optimized endpoint for status updates only.

**URL Parameters:**
- `id`: Engagement ID (number)

**Request Body:**

```json
{
  "status": "Completed"
}
```

**Response (200 OK):**

```json
{
  "id": 1234,
  "status": "Completed",
  "date_finished": "Jan 31, 2025"
}
```

**Backend Logic:**
- When `status` changes to `"Completed"`, automatically set `date_finished` to today's date
- Return both fields so frontend can update UI

---

### PATCH /engagements/:id/nna

Optimized endpoint for NNA updates only.

**URL Parameters:**
- `id`: Engagement ID (number)

**Request Body:**

```json
{
  "nna": 50000000
}
```

To clear NNA:
```json
{
  "nna": null
}
```

**Response (200 OK):**

```json
{
  "id": 1234,
  "nna": 50000000
}
```

---

### PATCH /engagements/:id/notes

Optimized endpoint for notes updates only.

**URL Parameters:**
- `id`: Engagement ID (number)

**Request Body:**

```json
{
  "notes": "Updated client notes here."
}
```

To clear notes:
```json
{
  "notes": null
}
```

**Response (200 OK):**

```json
{
  "id": 1234,
  "notes": "Updated client notes here."
}
```

---

### DELETE /engagements/:id

Delete an engagement permanently.

**URL Parameters:**
- `id`: Engagement ID (number)

**Response:** `204 No Content` (empty body)

**Error Response (404):**
```json
{
  "detail": "Engagement not found"
}
```

---

### GET /engagements/export

Export filtered engagements as CSV.

**Query Parameters:** Same as GET `/engagements` (excluding pagination)

**Response Headers:**
```
Content-Type: text/csv
Content-Disposition: attachment; filename="client-interactions-export.csv"
```

**Response Body (CSV):**
```csv
ID,External Client,Internal Client,Department,Intake Type,Ad Hoc Channel,Type,Team Members,Date Started,Date Finished,Status,Portfolio Logged,NNA,Notes,Tickers Mentioned
1234,"Vanguard Advisors","Avery Bennett","Advisory","Ad-Hoc","In-Person","Meeting","Alex M., Blake N.","Jan 15, 2025","Jan 20, 2025","Completed",true,25000000,"Client notes here","AAPL, MSFT, GOOGL"
```

---

## Data Types

### Engagement

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Unique identifier (auto-generated) |
| `external_client` | string \| null | External client company name (optional) |
| `internal_client` | InternalClient | Internal contact/relationship owner |
| `intake_type` | string | `IRQ`, `SERF`, or `Ad-Hoc` |
| `ad_hoc_channel` | string \| null | `In-Person`, `Email`, or `Teams` (only for Ad-Hoc) |
| `type` | string | Project type: `Meeting`, `Discovery Meeting`, `Data Request`, `Data Update`, `PCR`, `Other` |
| `team_members` | string[] | Array of team member names |
| `department` | string | Derived from `internal_client.client_department` |
| `date_started` | string | Formatted date (e.g., `"Jan 15, 2025"`) |
| `date_finished` | string | Formatted date or `"—"` if not finished |
| `status` | string | `In Progress`, `Completed`, or `On Hold` |
| `portfolio_logged` | boolean | Whether a portfolio was logged |
| `portfolio` | PortfolioHolding[] \| null | Optional portfolio holdings |
| `nna` | number \| null | Net New Assets in dollars |
| `notes` | string \| null | Optional notes |
| `tickers_mentioned` | string[] \| null | Tickers discussed (Ad-Hoc only, for Ticker Trends) |

### InternalClient

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Contact name |
| `client_department` | string | `Advisory`, `Brokerage`, or `Institutional` |

### PortfolioHolding

| Field | Type | Description |
|-------|------|-------------|
| `identifier` | string | Ticker, ISIN, or CUSIP |
| `asset_class` | string | `Equity`, `Fixed Income`, or `Alternatives` |
| `weight` | number | Normalized weight (0-1, sums to 1) |

### DayData (Contribution Heatmap)

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | ISO date string (e.g., `"2024-02-01"`) |
| `level` | number | Activity level 0-4 for heatmap coloring |
| `count` | number | Total engagements on this day |
| `project_count` | number | Project engagements (IRQ/SERF) |
| `ad_hoc_count` | number | Ad-Hoc engagements |

### IntakeBreakdown

| Field | Type | Description |
|-------|------|-------------|
| `intake` | string | Channel name: `In-Person`, `Email`, `Teams` |
| `count` | number | Number of engagements |
| `percent` | number | Percentage of total (0-100) |
| `color` | string | Hex color for chart |

### NNATier

| Field | Type | Description |
|-------|------|-------------|
| `label` | string | Tier label: `<$50M`, `$50-200M`, `$200M+` |
| `count` | number | Number of engagements in tier |
| `color` | string | Hex color for chart |

---

## Error Handling

All endpoints return errors in this format:

```json
{
  "detail": "Error message here"
}
```

| Status Code | Meaning |
|-------------|---------|
| 400 | Bad Request - Invalid parameters |
| 404 | Not Found - Resource doesn't exist |
| 422 | Unprocessable Entity - Validation failed |
| 500 | Internal Server Error |

---

## Performance Recommendations

### Initial Load

Use the POST `/dashboard` endpoint for initial page load. This single request returns:
- Pre-computed metrics for all 4 metric cards
- Department breakdown for the chart
- Contribution heatmap data
- First page of engagements
- Available filter options

This eliminates multiple round-trips and allows parallel rendering of all dashboard components.

### Subsequent Updates

| Action | Recommended Endpoint |
|--------|---------------------|
| Filter change | POST `/dashboard` with new filters |
| Table pagination | GET `/engagements` with page parameter |
| Status update | PATCH `/engagements/:id/status` |
| NNA update | PATCH `/engagements/:id/nna` |
| Notes update | PATCH `/engagements/:id/notes` |
| Full engagement edit | PATCH `/engagements/:id` |

### Caching Recommendations

- **Filter options**: Cache for session duration (rarely changes)
- **Department colors**: Static, can be hardcoded
- **Contribution data**: Cache for 5 minutes, invalidate on engagement create/update
- **Metrics**: Cache for 1 minute, invalidate on engagement changes

---

## Team Member Filtering

The team member filter supports these values:

| Value | Description |
|-------|-------------|
| `"All Team Members"` | No team member filter |
| `"Office B"` | Filter to Office B office members |
| `"Office A"` | Filter to Office A office members |
| `"Alex M."` | Filter to specific team member |

**Privacy Note**: The frontend only shows "All Team Members" and the current user. Users cannot filter by other team members' individual activity.

---

## Frontend Integration

The `client-interactions.ts` file handles:

1. **Toggle**: Set `USE_REAL_API = true` to use real API, `false` for mock data
2. **Base URL**: Set via `NEXT_PUBLIC_API_URL` env var (default: `http://localhost:8000/api`)
3. **Case conversion**: Automatic `snake_case` ↔ `camelCase` conversion
4. **Error handling**: Throws Error with message from `detail` field

```typescript
// Enable real API
const USE_REAL_API = true;

// Environment variable
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```
