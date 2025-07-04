/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

public with sharing class AccountService {

    static Date KNOWN_MONDAY = Date.newInstance(2025, 6, 30);

    public static void createAccountsAndContacts() {

        Decimal revenue = getRevenue();

        List<Account> accountsToInsert = new List<Account>();
        for (Integer i = 0; i < 300; i++) {
          Account acc = new Account();
          acc.Name = 'Account ' + i;
          acc.Description = 'This is account number ' + i;
          acc.AnnualRevenue = 15000;
          accountsToInsert.add(acc);
        }

        System.debug('Accounts to insert: ' + accountsToInsert);

        // Validate Accounts
        for (Account acc : accountsToInsert) {
            if (String.isBlank(acc.Name)) {
                throw new IllegalArgumentException('Account Name cannot be blank.');
            }
            if (acc.AnnualRevenue != null && acc.AnnualRevenue < 0) {
                throw new IllegalArgumentException('Annual Revenue cannot be negative.');
            }
        }

        // Insert Accounts
        try {
            insert accountsToInsert;
            System.debug('Accounts inserted successfully.');
        } catch (DmlException e) {
            System.debug('Error inserting accounts: ' + e.getMessage());
            throw e;
        }

        // Map Account Names to IDs for linking Contacts
        Map<String, Id> accountNameToIdMap = new Map<String, Id>();
        for (Account acc : accountsToInsert) {
            accountNameToIdMap.put(acc.Name, acc.Id);
        }

        List<Contact> contacts = new List<Contact>();
        for (Account acc : accountsToInsert) {
            Contact contact = new Contact(
                FirstName = 'Linked',
                LastName = 'Contact ' + acc.Name,
                AccountId = acc.Id
            );
            contacts.add(contact);
        }

        System.debug('Contacts to insert: ' + contacts);

        // Validate and link Contacts
        for (Contact con : contacts) {
            if (String.isBlank(con.LastName)) {
                throw new IllegalArgumentException('Contact Last Name cannot be blank.');
            }

            if (String.isBlank(con.AccountId)){
              throw new IllegalArgumentException('Contact must be linked to a valid Account.');
            }
        }

        // Query Accounts for additional validation
        Set<Id> accountIds = new Set<Id>();
        for (Contact con : contacts) {
          accountIds.add(con.AccountId);
        }
        accountIds.remove(null);

        Map<Id, Account> accountById = new Map<Id, Account>([SELECT Id, Name, AnnualRevenue FROM Account WHERE Id IN :accountIds]);
        System.debug('Queried Accounts: ' + accountById);

        // Perform additional validation based on queried Accounts
        for (Contact con : contacts) {
            Account relatedAccount = getAccount(con.AccountId, accountById);
            if (relatedAccount != null && relatedAccount.AnnualRevenue < 10000) {
                throw new IllegalArgumentException('Contact cannot be linked to an Account with Annual Revenue less than 10,000.');
            }
        }

        new RecursiveSearcher().search(17, 18, 1400);

        // Insert Contacts
        try {
            insert contacts;
            System.debug('Contacts inserted successfully.');
        } catch (DmlException e) {
            System.debug('Error inserting contacts: ' + e.getMessage());
            throw e;
        }

        System.debug('Account and Contact creation completed successfully.');
        new RecursiveSearcher().search(4, 8, 500);
        // LogUtil.burnLogStatements(7000);
        // LogUtil.burnCPU(500);
    }

    private static Account getAccount(Id accountId, Map<Id, Account> accountById){
      return accountById.get(accountId);
       // NOTE: Purposly using a loop and not a map to create a more dense debug log
        // for(Account a : accounts){
        //   if(a.Id == accountId) {
        //     return a;
        //   }
        // }
        // return null;
    }

    private static Decimal getRevenue() {

      return getDayValue(Date.today())* 10;
        // Date tdy = Date.today();
        // Date startOfYear = Date.newInstance(tdy.year(), 1, 1);
        // Date endOfYear = Date.newInstance(tdy.year(), 12, 31);


        // Decimal revenue  = 0 ;
        // while(startOfYear < tdy){
        //   revenue += getDayValue(startOfYear) * 2;
        //   startOfYear.addDays(1);
        // }

        // while(endOfYear > tdy){
        //   revenue += getDayValue(endOfYear);
        //   endOfYear.addDays(-1);
        // }

        // return revenue;

    }

    private static Decimal getDayValue(Date day) {
      Integer dayDiff = KNOWN_MONDAY.daysBetween(day);
      Integer dayIndex = Math.mod(dayDiff, 7);
      switch on dayIndex {
        when  0, 1, 2, 3, 4 {
          return 2000;
        }
        when  5 {
          return 1000;
        }
        when else {
          return 0;
        }
      }
    }

}
