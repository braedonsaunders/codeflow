export function MixedRender({ rawUserBio }: { rawUserBio: string }) {
  return (
    <div>
      <p dangerouslySetInnerHTML={{ __html: "<em>safe static copy</em>" }} />
      <div dangerouslySetInnerHTML={{ __html: rawUserBio }} />
    </div>
  );
}
