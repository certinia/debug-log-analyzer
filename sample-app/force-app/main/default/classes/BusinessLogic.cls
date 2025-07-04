/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
public with sharing class BusinessLogic {
    
    public static void validateAccountData(Account acc) {
        // Sample business logic for validating account data
        if (String.isEmpty(acc.Name)) {
            acc.addError('Account Name cannot be empty.');
        }
        // Additional validation logic can be added here
    }

    public static void validateContactData(Contact con) {
        // Sample business logic for validating contact data
        if (String.isEmpty(con.FirstName) || String.isEmpty(con.LastName)) {
            con.addError('Contact First Name and Last Name cannot be empty.');
        }
        if (con.AccountId == null) {
            con.addError('Contact must be linked to an Account.');
        }
        // Additional validation logic can be added here
    }
}