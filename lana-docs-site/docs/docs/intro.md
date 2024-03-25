---
id: my-home-doc
slug: /
sidebar_position: 1
---

# Introduction

Apex Log Analyzer makes performance analysis of Salesforce debug logs much easier and quicker. Visualize code execution via a Flame chart and Call Tree, identify and resolve performance and SOQL/DML problems via Method and Database Analysis.

![preview](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.14/lana-preview.gif)

## WARNING

> In general set the `APEX_CODE` debug flag to be `FINE` or higher, with a lower level the log will likely not contain enough detail for meaningful analysis.
>
> The quality of data shown depends entirely on the data contained in the log files.\
> Special care should be taken when looking at log files that have been truncated as you are only seeing a part of the execution and that may lead you to misunderstand what is really happening.
>
> A log level of `FINE` seems to give a good balance between log detail and execution time.\
> Higher log levels result in higher reported execution time than would be seen with logging off.\
> This is due to the over head associated with logging method entry and exit.
