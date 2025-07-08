---
id: index
title: Apex Log Analyzer
description: Apex Log Analyzer is a blazing-fast VS Code extension for Salesforce. Visualize and debug Apex logs with interactive flame charts, dynamic call trees, and detailed SOQL/DML breakdowns. Identify performance bottlenecks, gain deep transaction insights and optimize slow Apex.
slug: /
sidebar_position: 1
keywords:
  [
    salesforce,
    apex,
    debug logs,
    performance analysis,
    flame chart,
    log analyzer,
    vscode,
    vscode,
    logs,
    apex log analysis,
    visual studio code extension,
    salesforce debugging,
    apex logs,
    salesforce tools,
    salesforce extension,
    salesforce log analyzer,
    apex performance,
    salesforce productivity,
    salesforce troubleshooting,
    salesforce log analysis,
    apex code analysis,
  ]
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assests/v1.18/lana-timeline.png
hide_title: true
hide_table_of_contents: true
---

import Link from '@docusaurus/Link';
import styles from './styles.module.css';

<div className={styles.homePage}>
  <div>
    <h1 classname={styles.homePageHeader}>🚀 Apex Log Analyzer</h1>

    <p className={styles.homePageDescription}>
    Apex Log Analyzer for VS Code lets Salesforce developers debug Apex logs instantly with <strong>flame charts</strong>, <strong>call trees</strong>, and <strong>SOQL/DML</strong> insights - <strong>find bottlenecks fast</strong>
    </p>

    <div className={styles.heroButtons}>
      <Link className="button button--primary button--lg" to="/docs/gettingstarted">Get Started</Link>
      <span className={styles.indexCtasGitHubButtonWrapper}>
        <iframe
          className={styles.indexCtasGitHubButton}
          src="https://ghbtns.com/github-btn.html?user=certinia&amp;repo=debug-log-analyzer&amp;type=star&amp;count=true&amp;size=large"
          width={160}
          height={30}
          title="GitHub Stars"
        />
      </span>
    </div>

  </div>

<img
  src="https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assests/v1.18/lana-preview.gif"
  alt="Animated preview of the Apex Log Analyzer VS Code extension visualizing Salesforce Apex logs with flame charts and call trees"
  className={styles.previewImg}
  />

  <div className={styles.featureOverview}>
  <div/>

    <div className={styles.cardGrid}>

      <div className="card">
        <div className="card__header">
          <h3>Flame Chart Visualization</h3>
        </div>
        <div className="card__body">
          <p>See method timings in a modern flame chart. Instantly spot Apex transaction bottlenecks.</p>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <h3>Fast Log Parsing</h3>
        </div>
        <div className="card__body">
          <p>Processes massive Apex debug logs in fast using a high-performance parser - no lag, no waiting.</p>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <h3>Governor Limit Tracking</h3>
        </div>
        <div className="card__body">
          <p>Stay under limits with a clear, interactive view of SOQL, DML, time and more.</p>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <h3>Event Filtering</h3>
        </div>
        <div className="card__body">
          <p>Hide noise. Focus only on what you care about - from method calls to debug statements and limits.</p>
        </div>
      </div>

    </div>

    <section className={styles.visualImpactSection}>
      <div className={styles.visualContent}>
        <h2>Turn 200,000+ Lines of Logs into Actionable Insights</h2>
        <p>Raw log files are hard to scan, and easy to misread. The Apex Log Analyzer renders a high-resolution flame chart that maps out every method call, time taken, and nested operations.</p>
        <ul>
          <li>🌈 Color-coded log events</li>
          <li>🔎 Zoom & pan into areas of interest</li>
          <li>⏱ Time-based scaling to pinpoint slowdowns</li>
        </ul>
        <Link className="button button--secondary" to="/docs/features/timeline#-timeline--flame-chart">Learn More</Link>
      </div>
      <div className={styles.visualImage}>
        <img src="https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assests/v1.18/lana-timeline.png" alt="Flame chart of Apex log execution time" />
      </div>
    </section>

  </div>

</div>
