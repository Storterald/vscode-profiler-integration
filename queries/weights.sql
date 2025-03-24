SELECT callsiteId AS callstackId, 
        SUM("event#0x200000000e000") AS weight
FROM UnifiedSampleSeries 
GROUP BY callsiteId