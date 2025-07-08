---
id: find
title: Find
description: The Find feature in Apex Debug Log Analyzer for Salesforce quickly searches, highlights, and navigates through debug logs. Discover how Find enhances productivity by supporting case-sensitive search, matching text in Timeline, Call Tree, Analysis, and Database views.
keywords:
  [
    salesforce debug log analyzer,
    apex log search,
    salesforce productivity tools,
    debug log navigation,
    find in salesforce logs,
    salesforce developer tools,
  ]
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-timeline.png
---

The Find feature in Apex Debug Log Analyzer for Salesforce quickly searches, highlights, and navigates through debug logs. Discover how Find enhances productivity by supporting case-sensitive search, matching text in Timeline, Call Tree, Analysis, and Database views.

## 🔍 Find

- CMD/CTRL + f to open find
- Any matching text is highlighted, the current match has a lighter hightlight.
- Previous match, next match and case sensitive search all supported.

### Timeline

- If the next matching event is off screen that event will be centered on the timeline.
- The find will match on Event Type or text in the event
- The tooltip is shown for the current matching event, making it easy to view the event details such as Total or Self time.

<img
src="https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-timeline-find.png"
alt="Timeline screenshot showing highlighted search results and tooltip with event details"
style={{
  width: '50%', height:'auto', maxWidth:'400px'
}}/>

### Call Tree

- If the next matching text is within a parent that parent will be expanded.
- The row with the current matching text will also be highlighted

<img
src="https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-calltree-find.png"
alt="Call Tree view screenshot showing expanded parent nodes and highlighted search result"
style={{
  width: '50%', height:'auto', maxWidth:'400px'
}}/>

### Analysis + Database

- If the next matching text is within a group that group will be expanded.
- The row with the current matching text will also be highlighted

<img
src="https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-analysis-find.png"
alt="Analysis view screenshot showing expanded groups and highlighted search results"
style={{
  width: '50%', height:'auto', maxWidth:'400px'
}}/>
