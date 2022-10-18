'use strict';
var util = require('util');
var lodash = require('lodash');
var chalk = require('./chalk');

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
    alias:    'query',
    type:     'string',
    default:  '',
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
    alias:    'tag',
    type:     'array',
    default:  [],
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
  // log.printf('// HAHAHA: %s', chalk.yellow(JSON.stringify(problem)));
  const data = _.extend({}, problem);

  // unify format before rendering
  data.app = require('./config').app || 'leetcode';
  if (!data.fid) data.fid = data.id;
  if (!data.lang) data.lang = opts.lang;
  data.code = (opts.code || data.code || '').replace(/\r\n/g, '\n');
  data.comment = h.langToCommentStyle(data.lang);
  data.percent = data.percent.toFixed(2);
  data.testcase = util.inspect(data.testcase || '');
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
        let returnCode = '';
        let extClassName = '';
        let extClassCode = '';

        for (let i = 0; i < problem.templateMeta.params.length; i++) {
          let param = problem.templateMeta.params[i];
          switch (param.type) {
            case 'integer[]':
              codeArray.push(`        List<?> ${param.name}List = (List<?>)invocable.invokeFunction("parse", testcase[${i}]);`);
              codeArray.push(`        int[] ${param.name} = new int[${param.name}List.size()];`);
              codeArray.push(`        for(int i = 0; i < ${param.name}List.size(); i++) ${param.name}[i] = (int)${param.name}List.get(i);`);
              paramArray.push(param.name);
              break;
            case 'string[]':
              codeArray.push(`        List<?> ${param.name}List = (List<?>)invocable.invokeFunction("parse", testcase[${i}]);`);
              codeArray.push(`        String[] ${param.name} = new String[${param.name}List.size()];`);
              codeArray.push(`        for(int i = 0; i < ${param.name}List.size(); i++) ${param.name}[i] = (String)${param.name}List.get(i);`);
              paramArray.push(param.name);
              break;
            case 'integer':
              codeArray.push(`        int ${param.name} = (int)invocable.invokeFunction("parse", testcase[${i}]);`);
              paramArray.push(param.name);
              break;
            case 'string':
              codeArray.push(`        String ${param.name} = testcase[${i}];`);
              paramArray.push(param.name);
              break;
            case 'ListNode':
              extClassName = 'ListNode'
              codeArray.push(`        List<?> ${param.name}List = (List<?>)invocable.invokeFunction("parse", testcase[${i}]);`);
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
            default:
              codeArray.push(`        // TODO : ${param.type}`);
              paramArray.push(param.name);
              break;
          }
        }

        switch (problem.templateMeta.return.type) {
          case 'integer[]':
            returnCode = 'System.out.println(Arrays.toString(res));';
            break;
          case 'integer':
          case 'double':
          case 'boolean':
            returnCode = 'System.out.println(String.valueOf(res));';
            break;
          case 'ListNode':
            extClassName = 'ListNode'
            returnCode = 'System.out.println(res.val);';
            break;
          case 'string':
            returnCode = 'System.out.println(res);';
            break;
          default:
            codeArray.push(`        // TODO: ${problem.templateMeta.return.type}`);
            break;
        }

        if (extClassName === 'ListNode') {
          var myRegexp = new RegExp(' \\* public class ListNode[\\s\\S]+? \\* \\}', 'g');
          for (const template of problem.templates) {
            if (template.value == 'java') {
              var match = myRegexp.exec(template.defaultCode);
              const lines = match[0].split('\n');
              for (let index = 0; index < lines.length; index++) {
                const element = lines[index];
                if (index == 0) {
                  lines[index] = element.slice(10);
                } else {
                  lines[index] = element.slice(3);
                }
              }
              extClassCode = lines.join('\n');
            }
          }
        }
        data.package = `package lovecode_${problem.fid}_${lodash.snakeCase(problem.name)};

import java.util.*;
import javax.script.Invocable;
import javax.script.ScriptEngine;
import javax.script.ScriptEngineManager;
import javax.script.ScriptException;

`;
        data.main = `class Test {
    public static void main(String[] args) throws ScriptException, NoSuchMethodException {
        System.out.println("${problem.name}");
        String[] testcase = args;
        if (testcase.length == 0) {
          testcase = new String[] { ${problem.testcase.split('\n').map(str => addQuote(str)).join(', ')} };
        }
        ScriptEngine jsEngine = new ScriptEngineManager().getEngineByName("javascript");
        jsEngine.eval("function parse(json) { return Java.asJSONCompatible(JSON.parse(json)) }");
        Invocable invocable = (Invocable) jsEngine;

${codeArray.join('\n')}

        Solution solution${problem.fid} = new Solution();
        var res = solution${problem.fid}.${problem.templateMeta.name}(
          ${paramArray.join(', ')}
        );

        ${returnCode}
    }
}
${extClassCode}
`;
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
