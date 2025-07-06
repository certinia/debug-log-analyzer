# Sample Salesforce Apex Project

This project is a sample Salesforce Apex used to generate Apex Debug Logs for testing and gif creation. The project includes custom triggers, mock Apex logic and workflows.

Can be used to test log analyzer features including the go to code functionality.
Click on a class/method link in the call tree and you will be taken top the file in `force-app/main/default/classes`

## Setup Instructions

The sample log contains out from some managed packages that are not included in the install steps.
In future we should probably create mocks managed packages to test these cases.

1. Create an org: `sf org create scratch -f config/project-scratch-def.json -d -a sample -y 3 --async`
2. Deploy: `sf project deploy start -c -o sample`
3. Setup desired log levels e.g `APEX_CODE,FINE; APEX_PROFILING,FINE; CALLOUT,INFO; DB,FINEST; NBA,INFO; SYSTEM,DEBUG; VALIDATION,INFO; VISUALFORCE,FINE; WAVE,INFO; WORKFLOW,FINE`
4. In Dev console: `AccountService.createAccountsAndContacts();`
5. Download the log
