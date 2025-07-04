// todo: gap before

public class RecursiveSearcher {
      public RecursiveSearcher(){

      }

      public void search(SimTree node) {
        Long methodTime = System.currentTimeMillis();
        Long methodEndTime = methodTime + ( node.gapBeforeChildrenMillis);
        while(System.currentTimeMillis() < methodEndTime){
          // Math.cos(++i);
        }

        for(SimTree child :  node.children){
          search(child);
        }

        if( node.children.isEmpty()){
            methodTime = System.currentTimeMillis();
            methodEndTime = methodTime + node.durationMillis;
            while(System.currentTimeMillis() < methodEndTime){
              // Math.cos(++i);
            }
        }

        methodTime = System.currentTimeMillis();
        methodEndTime = methodTime + node.gapAfterChildrenMillis;
        while(System.currentTimeMillis() < methodEndTime){
          // Math.cos(++i);
        }
      }

      public void search(Integer rootCount, Integer depth, Integer maxDuration){
        List<SimTree> tree = new CallTreeGenerator().generateTree(rootCount, depth, maxDuration);
        for(SimTree node : tree) {
          search(node);
        }
      }


  public class CallTreeGenerator {
    private final Integer MIN_DURATION = 1;

    public List<SimTree> generateTree(Integer rootCount, Integer maxDepth, Integer maxDuration) {
        List<SimTree> roots = new List<SimTree>();
        for (Integer i = 0; i < rootCount; i++) {
            // Integer duration = 800 - i * 10;
            Integer duration = getDurationMs(i, 50, maxDuration);

            // For variety, assign per-root max depth limit deterministically:
            Boolean forceDeep = (Math.mod(i, 4) == 0); // every 4th root is deep
            // Boolean forceDeep = true;

            Integer rootMaxDepth = 4 + Math.mod(i * 7, maxDepth - 4); // between 4 and maxDepth
            roots.add(buildNode('Root' + i, 1, 0, maxDepth, duration, forceDeep, rootMaxDepth));
        }
        return roots;
    }

    private Integer getDurationMs(Integer i, Integer min, Integer max) {
      Integer range = max - min + 1;
      Integer seed = (i * 389) ^ (i * 41);
      return min + Math.mod(seed, range);
    }


    private SimTree buildNode(String name, Integer index, Integer depth, Integer globalMaxDepth, Integer totalDuration, Boolean forceDeep, Integer maxDepthLimit) {
        // Allow parent gap to vary from 3% at root to 1% at max depth
        Decimal depthRatio = (maxDepthLimit - depth) / Decimal.valueOf(maxDepthLimit);
        Decimal adjustedRatio = Math.sqrt(depthRatio);

        // Reduce base gap and multiplier to lower overall gap size
        Decimal maxGapPercent = 0.01 + adjustedRatio * 0.03;
        Integer maxGap = (Integer)(totalDuration * maxGapPercent);

        if (depth >= maxDepthLimit || totalDuration <= maxGap + MIN_DURATION) {
            return node(name, totalDuration).gap(0).gapAfter(0);
        }

        Integer preSeed = index * 17 + depth * 7;
        Integer postSeed = index * 13 + depth * 11;

        Integer preGap = Math.mod(preSeed, Math.max(1, maxGap / 7) + 1); // 0 to 1/7  maxGap
        Integer postGap = Math.mod(postSeed, Math.max(1, maxGap / 7) + 1);// 0 to  1/7 maxGap

        Integer available = totalDuration - maxGap - preGap - postGap;
        if (available < MIN_DURATION) {
            return node(name, totalDuration).gap(preGap).gapAfter(postGap);
        }

        List<SimTree> children = new List<SimTree>();

        Integer numChildren;
        if (forceDeep && depth < maxDepthLimit - 1) {
            numChildren = 1;

            if (forceDeep && depth < maxDepthLimit - 1) {
              Integer deepDuration = (Integer)(available * 0.99);
              SimTree child = buildNode(name + '_Deep', index + 1, depth + 1, globalMaxDepth, deepDuration, true, maxDepthLimit);
              child.gap(2);
              children.add(child);

              SimTree node = node(name, totalDuration).gap(preGap).gapAfter(postGap);
              node.children.addAll(children);
              return node;
          }

        } else {
          Integer minChildren = 0;

          Integer typicalMax = 2;
          Integer rareMax = 8;

          Integer raritySeed = index * 31 + depth * 17;
          Integer rareChance = Math.mod(raritySeed, 20);

          Boolean allowZero = rareChance == 0;           // ~5% chance of 0 children
          Boolean allowMany = rareChance == 1;           // ~5% chance of up to 8 children
          Integer maxChildrenAtDepth = allowMany ? rareMax : typicalMax;

          // Bias toward 1–2
          Integer baseChildren = Math.mod(index * 7 + depth * 13, typicalMax) + 1;

          // Apply variation: -1 to +1
          Integer variationSeed = (index + depth * 3) * 19;
          Integer variation = Math.mod(variationSeed, 3) - 1;

          // Combine, clamp
          numChildren = baseChildren + variation;

          // Allow 0 children only if allowZero is true
          if (numChildren <= 0 && !allowZero) {
              numChildren = 1;
          }

          numChildren = Math.max(0, Math.min(maxChildrenAtDepth, numChildren));
        }

        if (numChildren == 0) {
            return node(name, totalDuration).gap(preGap).gapAfter(postGap);
        }

        Integer gapPerChild = 1; // e.g., fixed 1ms gap before each child
        Integer totalGap = gapPerChild * numChildren;
        Integer availableForChildren = Math.max(0, available - totalGap);

        Integer perChildDuration = Math.max(availableForChildren / numChildren, MIN_DURATION);

        for (Integer i = 0; i < numChildren; i++) {
            SimTree child = buildNode(name + '_C' + i, index * 4 + i, depth + 1, maxDepthLimit, perChildDuration, false, maxDepthLimit);
            child.gap(gapPerChild);
            children.add(child);
        }

        SimTree node = node(name, totalDuration).gap(preGap).gapAfter(postGap);
        node.children.addAll(children);
        return node;
    }

    private SimTree node(String name, Integer duration) {
        return new SimTree(name, duration);
    }
  }

  public class SimTree {
    public String name;
    public Integer durationMillis;
    public Integer gapBeforeChildrenMillis = 0;
    public Integer gapAfterChildrenMillis = 0;
    public List<SimTree> children = new List<SimTree>();

    public SimTree(String name, Integer durationMillis) {
        this.name = name;
        this.durationMillis = durationMillis;
    }
    public SimTree gap(Integer millis) {
        this.gapBeforeChildrenMillis = millis;
        return this;
    }

    public SimTree gapAfter(Integer millis) {
        this.gapAfterChildrenMillis = millis;
        return this;
    }

    public SimTree children(List<SimTree> nodes) {
        this.children.addAll(nodes);
        return this;
    }
  }
}
