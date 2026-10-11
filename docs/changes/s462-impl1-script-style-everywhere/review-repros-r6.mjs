const P = (b) => `<program>\n<p>page</p>\n${b}\n</program>\n`;
export default {
  handler_arrow_script: P(`<button onclick={() => <script>x</script>}>b</button>`),
  handler_arrow_ok: P(`<n> = 0\n<button onclick={() => @n = @n + 1}>b</button>`),
  handler_lt_compare_ok: P(`<a> = 1\n<script_v> = 2\n<p>\${ @a < @script_v ? "y" : "n" }</p>`),
  v_pre_xmp: `<program>\n<f> = true\n<div>\${ @f ? <pre><xmp><!--</xmp><script>window.pwned=1</script>--></xmp></pre> : <b/> }</div>\n</program>\n`,
  meta_pre_script: P(`^{ emit("<pre><script>window.pwned=1</script></pre>") }`),
  meta_pre_xmp: P(`^{ emit("<pre><xmp><!--</xmp><script>window.pwned=1</script>--></xmp></pre>") }`),
  meta_code_style: P(`^{ emit("<code><style>body{color:red}</style></code>") }`),
  meta_pre_ok: P(`^{ emit("<pre>&lt;script&gt;</pre>") }`),
};
