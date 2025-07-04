/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
public with sharing class ContactTriggerHandler {

    public static void handleBeforeInsert(List<Contact> newContacts) {
        // Collect Account IDs from the new Contacts
        Set<Id> accountIds = new Set<Id>();
        for (Contact contact : newContacts) {
            if (contact.AccountId != null) {
                accountIds.add(contact.AccountId);
            }
        }

        // Query related Accounts
        Map<Id, Account> accountMap = new Map<Id, Account>(
            [SELECT Id, Name, AnnualRevenue FROM Account WHERE Id IN :accountIds]
        );

        for (Contact contact : newContacts) {
            // Ensure that the contact has a last name
            if (String.isBlank(contact.LastName)) {
                contact.LastName = 'Default Last Name';
            }

            // Validate related Account data
            if (contact.AccountId != null && accountMap.containsKey(contact.AccountId)) {
                Account relatedAccount = accountMap.get(contact.AccountId);
                if (relatedAccount.AnnualRevenue < 10000) {
                    contact.addError('The related Account must have an Annual Revenue of at least 10,000.');
                }
            }
        }
    }

    public static void handleBeforeUpdate(List<Contact> newContacts, Map<Id, Contact> oldContactMap) {
        for (Integer i = 0; i < newContacts.size(); i++) {
            Contact newContact = newContacts[i];
            Contact oldContact = oldContactMap.get(newContact.Id);

            // Sample business logic: Log changes to the contact's email
            if (newContact.Email != oldContact.Email) {
                System.debug('Email changed from ' + oldContact.Email + ' to ' + newContact.Email);
            }
        }
    }

    public static void handleAfterUpdate(List<Contact> newContacts, Map<Id, Contact> oldContactMap) {
    }

    public static void handleAfterInsert(List<Contact> newContacts) {
      List<Task> tasksToInsert = new List<Task>();

        for (Contact contact : newContacts) {
          BusinessLogic.validateContactData(contact);
            // Sample business logic: Create a related task for the new contact
            Task newTask = new Task(
                WhatId = contact.AccountId,
                WhoId = contact.Id,
                Subject = 'Follow up with new contact',
                Status = 'Not Started'
            );
            tasksToInsert.add(newTask);
        }
        insert tasksToInsert;

        new RecursiveSearcher().search(4, 8, 700);
      }
}