${comment.start}
${comment.line} @lc app=${app} id=${fid} lang=${lang}
${comment.line}
${comment.line} [${fid}] ${name}
${comment.end}

${package}

${comment.singleLine} @lc code=start
${code}
${comment.singleLine} @lc code=end
${comment.start}

@lc testcase=start
${testcaseCode}
@lc testcase=end

*${comment.end}

${main}
