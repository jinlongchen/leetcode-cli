'use strict';
var util = require('util');
var lodash = require('lodash');
// var chalk = require('./chalk');

var _ = require('underscore');
var cheerio = require('cheerio');
var he = require('he');

var log = require('./log');
var h = require('./helper');
var file = require('./file');
var Plugin = require('./plugin');

const core = new Plugin(99999999, 'core', '20170722', 'Plugins manager');

core.filters = {
  query: {
    alias: 'query',
    type: 'string',
    default: '',
    describe: [
      'Filter questions by condition:',
      'Uppercase means negative',
      'e = easy     E = m+h',
      'm = medium   M = e+h',
      'h = hard     H = e+m',
      'd = done     D = not done',
      'l = locked   L = non locked',
      's = starred  S = not starred'
    ].join('\n')
  },
  tag: {
    alias: 'tag',
    type: 'array',
    default: [],
    describe: 'Filter questions by tag'
  }
};

function hasTag(o, tag) {
  return Array.isArray(o) && o.some(x => x.indexOf(tag.toLowerCase()) >= 0);
}

function addQuote(json) {
  const obj = JSON.parse(json);
  if (typeof obj === 'string' || obj instanceof String)
    return json;
  else
    return `"${json.replace(/"/g, '\\"')}"`;
}

const isLevel = (x, q) => x.level[0].toLowerCase() === q.toLowerCase();
const isACed = x => x.state === 'ac';
const isLocked = x => x.locked;
const isStarred = x => x.starred;

const QUERY_HANDLERS = {
  e: isLevel,
  E: _.negate(isLevel),
  m: isLevel,
  M: _.negate(isLevel),
  h: isLevel,
  H: _.negate(isLevel),
  l: isLocked,
  L: _.negate(isLocked),
  d: isACed,
  D: _.negate(isACed),
  s: isStarred,
  S: _.negate(isStarred)
};

core.filterProblems = function (opts, cb) {
  this.getProblems(!opts.dontTranslate, function (e, problems) {
    if (e) return cb(e);

    for (let q of (opts.query || '').split('')) {
      const f = QUERY_HANDLERS[q];
      if (!f) continue;
      problems = problems.filter(x => f(x, q));
    }

    for (let t of (opts.tag || [])) {
      problems = problems.filter(function (x) {
        return x.category === t ||
          hasTag(x.companies, t) ||
          hasTag(x.tags, t);
      });
    }

    return cb(null, problems);
  });
};

core.getProblem = function (keyword, needTranslation, cb) {
  if (keyword.id)
    return core.next.getProblem(keyword, needTranslation, cb);

  this.getProblems(needTranslation, function (e, problems) {
    if (e) return cb(e);

    keyword = Number(keyword) || keyword;
    const metaFid = file.exist(keyword) ? Number(file.meta(keyword).id) : NaN;
    const problem = problems.find(function (x) {
      return x.fid + '' === keyword + '' || x.fid + '' === metaFid + '' || x.name === keyword || x.slug === keyword;
    });
    if (!problem) return cb('Problem not found!');
    core.next.getProblem(problem, needTranslation, cb);
  });
};

core.starProblem = function (problem, starred, cb) {
  if (problem.starred === starred) {
    log.debug('problem is already ' + (starred ? 'starred' : 'unstarred'));
    return cb(null, starred);
  }

  core.next.starProblem(problem, starred, cb);
};

core.exportProblem = function (problem, opts) {
  // log.printf('// %s', chalk.yellow(JSON.stringify(problem)));
  const data = _.extend({}, problem);

  // unify format before rendering
  data.app = require('./config').app || 'leetcode';
  if (!data.fid) data.fid = data.id;
  if (!data.lang) data.lang = opts.lang;
  data.code = (opts.code || data.code || '').replace(/\r\n/g, '\n');
  data.comment = h.langToCommentStyle(data.lang);
  data.percent = data.percent.toFixed(2);
  data.testcase = problem.testcase.replace(/\r?\n/g, '\\n');
  data.package = '';
  data.main = '';

  data.testcaseCode = problem.testcase

  if (opts.maincode) {
    switch (data.lang) {
      case 'golang': {
        data.package = `package main

import (
  "fmt"
)`;
        data.main = `func main() {
    fmt.Printf("%s", "${problem.name}")
}
`;
        break;
      }
      case 'java': {
        let codeArray = [];
        let paramArray = [];
        let returnCode = '        ';
        let otherFunc = '';
        let extClassName = '';
        let extClassCode = '';
        let resEquation = 'var res = ';

        for (let i = 0; i < problem.templateMeta.params.length; i++) {
          let param = problem.templateMeta.params[i];
          switch (param.type) {
            case 'integer[]':
              codeArray.push(`        List<?> ${param.name}List = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        int[] ${param.name} = new int[${param.name}List.size()];`);
              codeArray.push(`        for(int i = 0; i < ${param.name}List.size(); i++) ${param.name}[i] = (int)${param.name}List.get(i);`);
              paramArray.push(param.name);
              break;
            case 'string[]':
              codeArray.push(`        List<?> ${param.name}List = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        String[] ${param.name} = new String[${param.name}List.size()];`);
              codeArray.push(`        for(int i = 0; i < ${param.name}List.size(); i++) ${param.name}[i] = (String)${param.name}List.get(i);`);
              paramArray.push(param.name);
              break;
            case 'list<double>':
              codeArray.push(`        List<?> ${param.name}List = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        List<Double> ${param.name} = new ArrayList<>();`);
              codeArray.push(`        for(int i = 0; i < ${param.name}List.size(); i++) ${param.name}[i] = (Double)${param.name}List.get(i);`);
              paramArray.push(param.name);
              break;
            case 'double[]':
              codeArray.push(`        List<?> ${param.name}List = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        double[] ${param.name} = new double[${param.name}List.size()];`);
              codeArray.push(`        for(int i = 0; i < ${param.name}List.size(); i++) ${param.name}[i] = (double)${param.name}List.get(i);`);
              paramArray.push(param.name);
              break;
            case 'long[]':
              codeArray.push(`        List<?> ${param.name}List = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        Long[] ${param.name} = new Long[${param.name}List.size()];`);
              codeArray.push(`        for(int i = 0; i < ${param.name}List.size(); i++) ${param.name}[i] = (Long)${param.name}List.get(i);`);
              paramArray.push(param.name);
              break;
            case 'character[]':
              codeArray.push(`        List<?> ${param.name}List = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        char[] ${param.name} = new char[${param.name}List.size()];`);
              codeArray.push(`        for(int i = 0; i < ${param.name}List.size(); i++) ${param.name}[i] = ((String)${param.name}List.get(i)).charAt(0);`);
              paramArray.push(param.name);
              break;
            case 'boolean[]':
              codeArray.push(`        List<?> ${param.name}List = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        boolean[] ${param.name} = new boolean[${param.name}List.size()];`);
              codeArray.push(`        for(int i = 0; i < ${param.name}List.size(); i++) ${param.name}[i] = (boolean)${param.name}List.get(i);`);
              paramArray.push(param.name);
              break;
            case 'list<boolean>':
              codeArray.push(`        List<?> ${param.name}List = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        List<Boolean> ${param.name} = new ArrayList<>();`);
              codeArray.push(`        for(int i = 0; i < ${param.name}List.size(); i++) ${param.name}.add((Boolean)${param.name}List.get(i));`);
              paramArray.push(param.name);
              break;
            case 'list<string>':
            case 'list<String>':
              codeArray.push(`        List<?> ${param.name}List = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        List<String> ${param.name} = new ArrayList<>();`);
              codeArray.push(`        for(int i = 0; i < ${param.name}List.size(); i++) ${param.name}.add((String)${param.name}List.get(i));`);
              paramArray.push(param.name);
              break;
            case 'list<long>':
              codeArray.push(`        List<?> ${param.name}List = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        List<Long> ${param.name} = new ArrayList<>();`);
              codeArray.push(`        for(int i = 0; i < ${param.name}List.size(); i++) ${param.name}.add((Long)${param.name}List.get(i));`);
              paramArray.push(param.name);
              break;
            case 'list<integer>':
              codeArray.push(`        List<?> ${param.name}List = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        List<Integer> ${param.name} = new ArrayList<>();`);
              codeArray.push(`        for(int i = 0; i < ${param.name}List.size(); i++) ${param.name}.add((Integer)${param.name}List.get(i));`);
              paramArray.push(param.name);
              break;
            case 'long':
              codeArray.push(`        long ${param.name} = (long)new TestCaseParser().parseNumber(testcase[${i}]);`);
              paramArray.push(param.name);
              break;
            case 'character':
              codeArray.push(`        char ${param.name} = (char)new TestCaseParser().parseNumber(testcase[${i}]);`);
              paramArray.push(param.name);
              break;
            case 'double':
              codeArray.push(`        double ${param.name} = (double)new TestCaseParser().parseNumber(testcase[${i}]);`);
              paramArray.push(param.name);
              break;
            case 'boolean':
              codeArray.push(`        boolean ${param.name} = (boolean)new TestCaseParser().parseNumber(testcase[${i}]);`);
              paramArray.push(param.name);
              break;
            case 'integer':
              codeArray.push(`        int ${param.name} = (int)new TestCaseParser().parseNumber(testcase[${i}]);`);
              paramArray.push(param.name);
              break;
            case 'string':
              codeArray.push(`        String ${param.name} = new TestCaseParser().parseString(testcase[${i}]);`);
              paramArray.push(param.name);
              break;
            case 'ListNode':
              extClassName = 'ListNode'
              codeArray.push(`        List<?> ${param.name}List = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        ListNode ${param.name};
        ListNode ${param.name}Dummy = new ListNode();
        ListNode ${param.name}Head = ${param.name}Dummy;
        for(int i = 0; i < ${param.name}List.size(); i++) {
          Object item = ${param.name}List.get(i);
          if(item instanceof Integer){
            ${param.name}Head.next = new ListNode((int)item);
            ${param.name}Head = ${param.name}Head.next;
          }
        }
        ${param.name} = ${param.name}Dummy.next;
        `);
              paramArray.push(param.name);
              break;
            case 'ListNode[]':
              extClassName = 'ListNode'
              codeArray.push(`        List<?> ${param.name}ListListTmp = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        ListNode[] ${param.name}Array = new ListNode[${param.name}ListListTmp.size()];`);
              codeArray.push(`        for (int i = 0; i < ${param.name}ListListTmp.size(); i++) {`);
              codeArray.push(`          Object list = ${param.name}ListListTmp.get(i);`);
              codeArray.push('          ListNode dummy = new ListNode();');
              codeArray.push('          ListNode head = dummy;');
              codeArray.push('          for (int j = 0; j < ((List<?>) list).size(); j++) {');
              codeArray.push('            Object item = ((List<?>) list).get(j);');
              codeArray.push('            if (item instanceof Integer) {');
              codeArray.push('              head.next = new ListNode((int) item);');
              codeArray.push('              head = head.next;');
              codeArray.push('            }');
              codeArray.push('          }');
              codeArray.push(`          ${param.name}Array[i] = dummy.next;`);
              codeArray.push('        }');
              paramArray.push(`${param.name}Array`);
              break;
            case 'TreeNode':
              extClassName = 'TreeNode';
              codeArray.push(`        List<?> ${param.name}TreeList = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        TreeNode ${param.name} = TreeNode.construct(${param.name}TreeList);`);
              paramArray.push(param.name);
              break;
            case 'list<TreeNode>':
              extClassName = 'TreeNode';
              codeArray.push(`        List<TreeNode> ${param.name} = new ArrayList<>();`);
              codeArray.push(`        List<?> treesList = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push('        for (int i = 0; i < treesList.size(); i++) {');
              codeArray.push('          var curr = treesList.get(i);');
              codeArray.push('          if (curr instanceof List<?>) {');
              codeArray.push(`            ${param.name}.add(TreeNode.construct((List<?>)curr));`);
              codeArray.push('          }');
              codeArray.push('        }');
              paramArray.push(param.name);
              break;
            case 'character[][]':
              codeArray.push(`        List<?> ${param.name}ListListTmp = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        char[][] ${param.name}Array = new char[${param.name}ListListTmp.size()][];`);
              codeArray.push(`        for (int i = 0; i < ${param.name}ListListTmp.size(); i++) {`);
              codeArray.push(`          Object list = ${param.name}ListListTmp.get(i);`);
              codeArray.push('          char[] array = new char[((List<?>) list).size()];');
              codeArray.push('          for (int j = 0; j < ((List<?>) list).size(); j++) {');
              codeArray.push('            Object item = ((List<?>) list).get(j);');
              codeArray.push('            if (item instanceof Character) {');
              codeArray.push('              array[j] = (Character)item;');
              codeArray.push('            } else if (item instanceof String) {');
              codeArray.push('              array[j] = ((String)item).charAt(0);');
              codeArray.push('            }');
              codeArray.push('          }');
              codeArray.push(`          ${param.name}Array[i] = array;`);
              codeArray.push('        }');
              paramArray.push(`${param.name}Array`);
              break;
            case 'integer[][]':
              codeArray.push(`        List<?> ${param.name}ListListTmp = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        int[][] ${param.name}Array = new int[${param.name}ListListTmp.size()][];`);
              codeArray.push(`        for (int i = 0; i < ${param.name}ListListTmp.size(); i++) {`);
              codeArray.push(`          Object list = ${param.name}ListListTmp.get(i);`);
              codeArray.push('          int[] array = new int[((List<?>) list).size()];');
              codeArray.push('          for (int j = 0; j < ((List<?>) list).size(); j++) {');
              codeArray.push('            Object item = ((List<?>) list).get(j);');
              codeArray.push('            if (item instanceof Integer) {');
              codeArray.push('              array[j] = (Integer)item;');
              codeArray.push('            }');
              codeArray.push('          }');
              codeArray.push(`          ${param.name}Array[i] = array;`);
              codeArray.push('        }');
              paramArray.push(`${param.name}Array`);
              break;
            case 'list<list<integer>>':
              codeArray.push(`        List<?> ${param.name}ListListTmp = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        List<List<Integer>> ${param.name}ListList = new int[${param.name}ListListTmp.size()][];`);
              codeArray.push(`        for (int i = 0; i < ${param.name}ListListTmp.size(); i++) {`);
              codeArray.push(`          Object listTmp = ${param.name}ListListTmp.get(i);`);
              codeArray.push('          List<Integer> ${param.name}List = new ArrayList<>();');
              codeArray.push('          for (int j = 0; j < ((List<?>) listTmp).size(); j++) {');
              codeArray.push('            Object item = ((List<?>) listTmp).get(j);');
              codeArray.push('            if (item instanceof Integer) {');
              codeArray.push('              ${param.name}List.add((Integer)item);');
              codeArray.push('            }');
              codeArray.push('          }');
              codeArray.push(`          ${param.name}ListList[i].add(${param.name}List);`);
              codeArray.push('        }');
              paramArray.push(`${param.name}ListList`);
              break;
            case 'list<list<long>>':
              codeArray.push(`        List<?> ${param.name}ListListTmp = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        List<List<Long>> ${param.name}ListList = new int[${param.name}ListListTmp.size()][];`);
              codeArray.push(`        for (int i = 0; i < ${param.name}ListListTmp.size(); i++) {`);
              codeArray.push(`          Object listTmp = ${param.name}ListListTmp.get(i);`);
              codeArray.push('          List<Long> ${param.name}List = new ArrayList<>();');
              codeArray.push('          for (int j = 0; j < ((List<?>) listTmp).size(); j++) {');
              codeArray.push('            Object item = ((List<?>) listTmp).get(j);');
              codeArray.push('            if (item instanceof Long) {');
              codeArray.push('              ${param.name}List.add((Long)item);');
              codeArray.push('            }');
              codeArray.push('          }');
              codeArray.push(`          ${param.name}ListList[i].add(${param.name}List);`);
              codeArray.push('        }');
              paramArray.push(`${param.name}ListList`);
              break;
            case 'list<list<string>>':
              codeArray.push(`        List<?> ${param.name}ListListTmp = new TestCaseParser().parseList(testcase[${i}]);`);
              codeArray.push(`        List<List<String>> ${param.name}ListList = new int[${param.name}ListListTmp.size()][];`);
              codeArray.push(`        for (int i = 0; i < ${param.name}ListListTmp.size(); i++) {`);
              codeArray.push(`          Object listTmp = ${param.name}ListListTmp.get(i);`);
              codeArray.push('          List<String> ${param.name}List = new ArrayList<>();');
              codeArray.push('          for (int j = 0; j < ((List<?>) listTmp).size(); j++) {');
              codeArray.push('            Object item = ((List<?>) listTmp).get(j);');
              codeArray.push('            if (item instanceof String) {');
              codeArray.push('              ${param.name}List.add((String)item);');
              codeArray.push('            }');
              codeArray.push('          }');
              codeArray.push(`          ${param.name}ListList[i].add(${param.name}List);`);
              codeArray.push('        }');
              paramArray.push(`${param.name}ListList`);
              break;
            case 'list<NestedInteger>':
              extClassName = 'NestedInteger';
              codeArray.push(`        List<NestedInteger> ${param.name} = NestedInteger.deserialize(testcase[${i}]).getList();`);
              paramArray.push(param.name);
              break;
            default:
              codeArray.push(`        // ${param.type} not supported`);
              paramArray.push(param.name);
              break;
          }
        }

        switch (problem.templateMeta.return.type) {
          case 'string':
            returnCode = '        System.out.println(res);';
            break;
          case 'ListNode':
            extClassName = 'ListNode'
            returnCode = `        while (res != null) {
            System.out.print(res.val);
            res = res.next;
            if (res != null) {
              System.out.print(" -> ");
            }
          }
          System.out.println();`;
            break;
          case 'TreeNode':
            extClassName = 'TreeNode'
            returnCode = `        printTree(res);
            System.out.println();`;
            otherFunc = `    static void printTree(TreeNode node) {
        if (node == null) {
            System.out.println("<null>");
            return;
        }
        System.out.println(node.val);
        printTree(node.right, "", true);
        printTree(node.left, "", false);
    }
    static void printTree(TreeNode n, String prefix, boolean isRight) {
        if (n != null) {
            System.out.println(prefix + (isRight ? "├──(R) " : "└──(L) ") + n.val);
            printTree(n.left, prefix + (isRight ? "│   " : "    "), true);
            printTree(n.right, prefix + (isRight ? "│   " : "    "), false);
        } else {
            System.out.println(prefix + (isRight ? "├──(R) <null>" : "└──(L) <null>"));
        }
    }
`;
            break;
          case 'void':
            resEquation = '';
            break;
          case 'character[][]':
          case 'integer[][]':
            returnCode = '        System.out.println(Arrays.deepToString(res));';
            break;
          case 'integer[]':
          case 'double[]':
          case 'string[]':
            returnCode = '        System.out.println(Arrays.toString(res));';
            break;
          default:
            returnCode = '        System.out.println(String.valueOf(res));';
            break;
        }

        if (extClassName === 'ListNode') {
          extClassCode = `class ListNode {
    int val;
    ListNode next;
    ListNode() {}
    ListNode(int val) { this.val = val; }
    ListNode(int val, ListNode next) { this.val = val; this.next = next; }
}`;
        } else if (extClassName === 'NestedInteger') {
          extClassCode = `class NestedInteger {
    private List<NestedInteger> nestedInteger = new ArrayList<>();
    private Integer val;
    public NestedInteger() {
    }

    public NestedInteger(int value) {
        this.val = value;
    }

    public boolean isInteger() {
        return val != null;
    }

    public Integer getInteger() {
        return val;
    }

    public void setInteger(int value) {
        this.val = value;
    }

    public void add(NestedInteger ni) {
        this.nestedInteger.add(ni);
    }

    public List<NestedInteger> getList() {
        return val != null ? null : nestedInteger;
    }

    public static NestedInteger deserialize(String s) {
        Stack<NestedInteger> stack = new Stack<>();

        NestedInteger current = null;
        StringBuffer subInteger = new StringBuffer();
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) == '[') {
                if (current != null) {
                    stack.push(current);
                }
                current = new NestedInteger();
                subInteger = new StringBuffer();
            } else if (s.charAt(i) == ']') {
                if (subInteger.length() > 0) {
                    current.add(new NestedInteger(Integer.parseInt(subInteger.toString())));
                    subInteger = new StringBuffer();
                }
                if (!stack.isEmpty()) {
                    NestedInteger top = stack.pop();
                    top.add(current);
                    current = top;
                }
            } else if (s.charAt(i) == ',') {
                if (subInteger.length() > 0) {
                    current.add(new NestedInteger(Integer.parseInt(subInteger.toString())));
                }
                subInteger = new StringBuffer();
            } else {
                subInteger.append(s.charAt(i));
            }
        }
        if (subInteger.length() > 0) {
            return new NestedInteger(Integer.parseInt(subInteger.toString()));
        }
        return current;
    }
}`;
        } else if (extClassName === 'TreeNode') {
          extClassCode = `class TreeNode {
  int val;
  TreeNode left;
  TreeNode right;

  TreeNode() {
  }

  TreeNode(int val) {
    this.val = val;
  }

  TreeNode(int val, TreeNode left, TreeNode right) {
    this.val = val;
    this.left = left;
    this.right = right;
  }

  public static TreeNode construct(List<?> list) {
    int n = list.size();
    if (n == 0) {
      return null;
    }
    TreeNode[] arr = new TreeNode[n];
    for (int i = 0; i < n; i++) {
      if (list.get(i) == null) {
        arr[i] = null;
      } else {
        // if(list.get(i) instanceof Integer){
        //   arr[i] = new TreeNode((Integer) list.get(i));
        // } else {
        //   
        // }
        arr[i] = new TreeNode((Integer) list.get(i));
      }
    }
    for (int i = 0, j = 1; j < n; i++) {
      if (arr[i] == null) {
        continue;
      }
      arr[i].left = arr[j++];
      if (j < n) {
        arr[i].right = arr[j++];
      }
    }
    return arr[0];
  }
}`;
          //           extClassCode = `class TreeNode<E> {
          //   E val;
          //   TreeNode<E> left;
          //   TreeNode<E> right;
          //
          //   TreeNode() {
          //   }
          //
          //   TreeNode(E val) {
          //     this.val = val;
          //   }
          //
          //   TreeNode(E val, TreeNode<E> left, TreeNode<E> right) {
          //     this.val = val;
          //     this.left = left;
          //     this.right = right;
          //   }
          //
          //   public static <E> TreeNode<E> construct1(List<E> list) {
          //     int n = list.size();
          //     if (n == 0) {
          //       return null;
          //     }
          //     List<TreeNode<E>> listTmp = new ArrayList<>(n);
          //     for (int i = 0; i < n; i++) {
          //       if (list.get(i) == null) {
          //         listTmp.add(null);
          //       } else {
          //         listTmp.add(new TreeNode<>(list.get(i)));
          //       }
          //     }
          //     for (int i = 0, j = 1; j < n; i++) {
          //       if (listTmp.get(i) == null) {
          //         continue;
          //       }
          //       listTmp.get(i).left = listTmp.get(j++);
          //       if (j < n) {
          //         listTmp.get(i).right = listTmp.get(j++);
          //       }
          //     }
          //     return listTmp.get(0);
          //   }
          // }`;
        }
        data.package = `package lovecode_${problem.fid}_${lodash.snakeCase(problem.name)};

import java.util.*;`;
        data.main = `// #region Test Code
class Test {
    public static void main(String[] args) {
        System.out.println("${problem.name}");
        String[] testcase = args;
        if (testcase.length == 0) {
          testcase = new String[] { ${problem.testcase.split('\n').map(str => addQuote(str)).join(', ')} };
        }

${codeArray.join('\n')}

        Solution solution${problem.fid} = new Solution();
        ${resEquation}solution${problem.fid}.${problem.templateMeta.name}(
          ${paramArray.join(', ')}
        );

${returnCode}
    }
${otherFunc}
}
${extClassCode}
class TestCaseParser {
    int curPos = 0;

    String parseString(String str) {
        if (++curPos >= str.length()) {
            return str;
        }
        String res = "";
        var escape = false;
        for (int i = curPos; i < str.length(); i++) {
            var ch = str.charAt(i);
            if (ch == '\\\\') {
                escape = true;
                continue;
            }
            if (escape) {
                escape = false;
                switch (ch) {
                    case '"':
                        res += '"';
                        break;
                    case '\\\\':
                        res += '\\\\';
                        break;
                    case 't':
                        res += '\\t';
                        break;
                    case 'n':
                        res += '\\n';
                        break;
                }
                continue;
            }
            if (ch == '"') {
                curPos = i + 1;
                break;
            }
            res += ch;
        }

        return res;
    }

    Number parseNumber(String str) {
        String res = "";
        if (str.charAt(curPos) == '-') {
            res = "-";
            curPos++;
        } else if (str.charAt(curPos) == '+') {
            curPos++;
        }
        for (int i = curPos; i < str.length(); i++) {
            var ch = str.charAt(i);
            if (Character.isDigit(ch) || ch == '.') {
                res += ch;
                curPos++;
            } else {
                break;
            }
        }
        if (res.contains(".")) {
            return Double.parseDouble(res);
        } else {
            return Integer.parseInt(res);
        }
    }

    List<?> parseList(String str) {
        List<Object> list = new ArrayList<>();
        if (++curPos >= str.length()) {
            return list;
        }
        while (str.charAt(curPos) == ' ') {
            curPos++;
        }
        while (curPos < str.length()) {
            var curCh = str.charAt(curPos);
            if (str.charAt(curPos) == 'n' && str.charAt(curPos + 1) == 'u' &&
                    str.charAt(curPos + 2) == 'l' && str.charAt(curPos + 3) == 'l') {
                list.add(null);
                curPos += 4;
                continue;
            }
            if (curCh == ',') {
                curPos++;
                while (str.charAt(curPos) == ' ') {
                    curPos++;
                }
            } else if (curCh == '[') {
                var child = parseList(str);
                list.add(child);
            } else if (curCh == ']') {
                curPos++;
                return list;
            } else if (curCh == '"') {
                var child = parseString(str);
                list.add(child);
            } else if (curCh == '\\r' || curCh == '\\n' || curCh == '\\t' || curCh == ' ') {
                curPos++;
            } else {
                var child = parseNumber(str);
                list.add(child);
            }
        }
        return list;
    }
}
// #endregion`;
        break;
      }
    }
  }

  if (opts.tpl === 'detailed') {
    let desc = data.desc;
    // Replace <sup/> with '^' as the power operator
    desc = desc.replace(/<\/sup>/gm, '').replace(/<sup>/gm, '^');
    desc = he.decode(cheerio.load(desc).root().text());
    // NOTE: wordwrap internally uses '\n' as EOL, so here we have to
    // remove all '\r' in the raw string.
    desc = desc.replace(/\r\n/g, '\n').replace(/^ /mg, '⁠');
    const wrap = require('wordwrap')(79 - data.comment.line.length);
    data.desc = wrap(desc).split('\n');
  }

  return file.render(opts.tpl, data);
};

module.exports = core;
