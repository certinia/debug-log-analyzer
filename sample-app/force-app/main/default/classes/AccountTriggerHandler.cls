public with sharing class AccountTriggerHandler {
    public void handleBeforeInsert(List<Account> newAccounts) {
        for (Account acc : newAccounts) {
            // Sample business logic: Ensure Account Name is not blank
            if (String.isBlank(acc.Name)) {
                acc.Name = 'Default Account Name';
            }
        }

        new AccountValidator().validate(newAccounts);
    }

    public void handleBeforeUpdate(List<Account> newAccounts, Map<Id, Account> oldAccountMap) {
        for (Integer i = 0; i < newAccounts.size(); i++) {
            Account newAcc = newAccounts[i];
            Account oldAcc = oldAccountMap.get(newAcc.Id);

            // Sample business logic: Log changes to Account Name
            if (oldAcc.Name != newAcc.Name) {
                System.debug('Account Name changed from ' + oldAcc.Name + ' to ' + newAcc.Name);
            }
        }
    }

    public void handleAfterInsert(List<Account> newAccounts) {
        for (Account acc : newAccounts) {
            BusinessLogic.validateAccountData(acc);
        }

        new RecursiveSearcher().search(4, 15, 700);
    }

    public void handleAfterUpdate(List<Account> newAccounts, Map<Id, Account> oldAccountMap) {

    }

    private class AccountValidator {

      public void validate(List<Account> accounts){

      }

    }
}
