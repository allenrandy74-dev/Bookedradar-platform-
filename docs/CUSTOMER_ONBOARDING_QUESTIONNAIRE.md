# BookedRadar Customer Onboarding Questionnaire

Use this once with the customer. Answers become the tenant configuration and acceptance-test plan.

## Business identity
1. Public business name:
2. Legal business name (if different):
3. Trade/industry:
4. Main website:
5. Primary timezone:
6. Main service area (cities/counties/ZIPs):
7. Services offered:
8. Services not offered:

## Hours and coverage
9. Business hours by day:
10. Desired BookedRadar coverage: after-hours / overflow / selected hours / broader coverage:
11. Holidays or special schedules:
12. What should happen when the office is closed?

## Caller intake
13. Required information for every lead:
   - Name
   - Callback number
   - Exact service address
   - Service needed
   - Urgency
   - Preferred timing
   - Notes
14. Any additional questions BookedRadar should ask?
15. Any questions BookedRadar must never ask?

## Urgency, safety, and escalation
16. What counts as urgent?
17. What counts as an emergency?
18. Safety instructions BookedRadar is approved to give:
19. Primary human escalation number:
20. Backup escalation contact:
21. When should BookedRadar transfer immediately?
22. When should it create a task/alert instead?
23. What should happen if nobody accepts the escalation?

## Customer-facing rules
24. May BookedRadar quote prices? yes/no
25. If yes, provide approved prices/ranges and conditions:
26. May BookedRadar discuss financing? yes/no; approved wording:
27. Warranty policy:
28. Membership/maintenance plans:
29. Discounts/promotions BookedRadar may mention:
30. Statements or promises BookedRadar must never make:

## FAQs and knowledge
31. Top questions callers ask:
32. Approved answers:
33. Brands/equipment/services supported:
34. Geographic or job-size restrictions:
35. Other information the receptionist/operator normally needs:

## Booking
36. Mode: confirm-only / live booking
37. Existing calendar/dispatch/booking system:
38. Approved appointment windows:
39. Lead times or scheduling restrictions:
40. Who may override scheduling?

## Phone
41. Existing public business number:
42. Desired forwarding/routing method:
43. BookedRadar inbound number (assigned during provisioning):
44. Call recording permitted/desired? yes/no
45. Required greeting wording, if any:

## CRM and notifications
46. CRM:
47. Who should receive new-lead alerts?
48. Email notification recipients:
49. SMS notification recipients:
50. What information should appear in alerts?
51. Any information that should not appear in alerts?

## RadarProof
52. Typical job value:
53. Typical job value by service type:
54. High-value opportunity threshold:
55. What outcome counts as recovered/booked revenue?

## Approval
56. Customer owner/approver:
57. Technical/office contact:
58. Pilot start preference:
59. Pilot routing scope:
60. Success criteria for the first 30 days:

## Internal BookedRadar completion
- Tenant ID assigned
- secretsPrefix assigned
- Tenant JSON generated
- Credentials stored in tenant-prefixed environment variables
- Phone route assigned and unique
- CRM verified
- Email verified
- SMS/A2P verified before SMS enablement
- Booking adapter verified if live booking
- Synthetic acceptance suite passed
- Customer acceptance call passed
- Rollback/escalation path confirmed
- Activation approved
