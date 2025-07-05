/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
public with sharing class LogUtil {
    public static void burnCPU(Integer msToWait) {
        Long startTime = System.currentTimeMillis();
        Long endTime = startTime + msToWait;

        Integer len = Math.max((Integer)(msToWait * 1000), 1000);
        Integer x = 0;

        while(System.currentTimeMillis() < endTime){
            for(Integer i = 0; i < len;i++ ){
                x++;
            }
        }
    }

    public static void burnLogStatements(Integer numStatements) {
        Double exp = 0.5;
        for(Integer i = 0; i< numStatements; i++) {
            Double d1 = i + 0.99;
            Double result = Math.pow(d1, exp);
        }
    }
}